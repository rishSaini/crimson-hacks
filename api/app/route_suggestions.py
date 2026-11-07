"""Rank existing mapped ski sections near a drawn route without joining their geometry."""

import json
from datetime import date as Date
from pathlib import Path
from typing import Literal

import numpy as np
from pydantic import Field, model_validator
from shapely import LineString as ShapeLine, transform

from app.models import (
    ApiModel, AnalyzeRequest, AnalyzeResponse, AvoidThreshold, DataSource,
    ForecastResponse, LineString, RouteComparison,
)
from app.route_analysis import TO_UTM, TerrainCoverageError, TerrainGrids, analyze_route

Difficulty = Literal['novice', 'easy', 'intermediate', 'advanced', 'expert', 'extreme']
DIFFICULTIES = ('novice', 'easy', 'intermediate', 'advanced', 'expert', 'extreme')
CATALOG_PATH = Path(__file__).resolve().parents[2] / 'data/routes/openskidata.geojson'
WARNING_LIMITATION = 'UAC recommends avoiding all avalanche terrain today.'
LIMITATIONS = [
    'Catalog features can represent only sections of a tour. Confirm the complete itinerary.',
    'Difficulty comes from OpenStreetMap piste tags. Snow conditions can change the required skills.',
    'Access, closures, obstacles, snow coverage, and route completeness require separate confirmation.',
    'Exposure checks use a 10 m DEM and the selected forecast. They do not establish route feasibility.',
]


class SuggestionsRequest(AnalyzeRequest):
    max_difficulty: Difficulty = Field(description='Highest OSM piste grade the user accepts')
    max_distance_m: float = Field(gt=0, le=100000, allow_inf_nan=False)
    max_climb_ft: float = Field(ge=0, le=30000, allow_inf_nan=False)
    corridor_width_m: float = Field(default=400, ge=50, le=1500, allow_inf_nan=False)
    endpoint_tolerance_m: float = Field(default=200, ge=0, le=500, allow_inf_nan=False)
    limit: int = Field(default=3, ge=1, le=10)


class SourceReference(ApiModel):
    id: str
    type: Literal['openstreetmap']


class CatalogProperties(ApiModel):
    id: str = Field(min_length=1)
    name: str | None
    difficulty: str | None
    status: str | None
    sources: list[SourceReference] = Field(min_length=1)
    route_scope: Literal['mapped_section']
    oneway: bool | None


class CatalogFeature(ApiModel):
    type: Literal['Feature']
    geometry: LineString
    properties: CatalogProperties

    @model_validator(mode='after')
    def valid_geography(self) -> 'CatalogFeature':
        coordinates = np.asarray(self.geometry.coordinates)
        if not np.isfinite(coordinates).all() or not (
            (np.abs(coordinates[:, 0]) <= 180).all() and
            (np.abs(coordinates[:, 1]) <= 90).all()
        ):
            raise ValueError('Catalog coordinates must be finite longitude and latitude.')
        return self


class Catalog(ApiModel):
    type: Literal['FeatureCollection']
    source: str
    source_url: str
    retrieved_at: str
    license: str
    license_url: str
    attribution: str
    features: list[CatalogFeature]

    @model_validator(mode='after')
    def unique_ids(self) -> 'Catalog':
        ids = [feature.properties.id for feature in self.features]
        if len(set(ids)) != len(ids):
            raise ValueError('Catalog route IDs must be unique.')
        return self


class CatalogInfo(ApiModel):
    source: str
    source_url: str
    retrieved_at: str
    license: str
    license_url: str
    attribution: str
    feature_count: int


class SuggestedRoute(ApiModel):
    id: str
    name: str | None
    difficulty: Difficulty
    route_scope: Literal['mapped_section']
    source_urls: list[str]
    route: LineString
    analysis: AnalyzeResponse
    comparison: RouteComparison
    start_distance_m: float
    end_distance_m: float


class SuggestionsResponse(ApiModel):
    date: Date
    source: DataSource
    avoid_at_or_above: AvoidThreshold = Field(description='The setting actually applied')
    forced_by_warning: bool
    status: Literal['found', 'no_match']
    message: str
    catalog: CatalogInfo
    original_analysis: AnalyzeResponse
    suggestions: list[SuggestedRoute]
    excluded: dict[str, int]
    limitations: list[str]


def load_catalog(path: Path = CATALOG_PATH) -> Catalog:
    return Catalog.model_validate(json.loads(path.read_text()))


def projected_line(route: LineString) -> ShapeLine:
    return transform(ShapeLine(route.coordinates), TO_UTM.transform, interleaved=False)


def suggest_routes(
    request: SuggestionsRequest, forecast: ForecastResponse,
    grids: TerrainGrids, catalog: Catalog,
) -> SuggestionsResponse:
    original = analyze_route(request, forecast, grids)
    drawn = projected_line(request.route).segmentize(15)
    corridor = drawn.buffer(request.corridor_width_m)
    accepted = []
    excluded: dict[str, int] = {}

    for feature in catalog.features:
        properties = feature.properties
        reason = None
        if properties.status != 'operating':
            reason = 'operating_status_unknown_or_closed'
        elif properties.difficulty not in DIFFICULTIES:
            reason = 'difficulty_unknown'
        elif DIFFICULTIES.index(properties.difficulty) > DIFFICULTIES.index(request.max_difficulty):
            reason = 'difficulty_limit'
        if reason is not None:
            excluded[reason] = excluded.get(reason, 0) + 1
            continue

        route = feature.geometry
        line = projected_line(route).segmentize(15)
        direct = (np.linalg.norm(np.asarray(line.coords[0]) - drawn.coords[0]),
                  np.linalg.norm(np.asarray(line.coords[-1]) - drawn.coords[-1]))
        reverse = (np.linalg.norm(np.asarray(line.coords[-1]) - drawn.coords[0]),
                   np.linalg.norm(np.asarray(line.coords[0]) - drawn.coords[-1]))
        if properties.oneway is False and sum(reverse) < sum(direct):
            route = LineString(coordinates=list(reversed(route.coordinates)))
            line = projected_line(route).segmentize(15)
            direct = reverse
        start_distance, end_distance = map(float, direct)
        # Both routes must fit in each other's corridor, preventing short nearby fragments
        # from replacing a much longer intended route. Endpoint gaps remain visible.
        if max(direct) > request.endpoint_tolerance_m:
            reason = 'endpoints_too_far'
        elif not corridor.covers(line) or not line.buffer(request.corridor_width_m).covers(drawn):
            reason = 'outside_corridor'
        else:
            try:
                analysis = analyze_route(AnalyzeRequest(
                    route=route, date=request.date, avoid_at_or_above=request.avoid_at_or_above,
                ), forecast, grids)
            except TerrainCoverageError:
                reason = 'incomplete_terrain_coverage'
            else:
                if analysis.totals.length_m > request.max_distance_m:
                    reason = 'distance_limit'
                elif analysis.totals.climb_ft > request.max_climb_ft:
                    reason = 'climb_limit'
                elif analysis.totals.flagged_length_m > 0:
                    reason = 'forecast_exposure'
        if reason is not None:
            excluded[reason] = excluded.get(reason, 0) + 1
            continue

        accepted.append(SuggestedRoute(
            id=properties.id, name=properties.name, difficulty=properties.difficulty,
            route_scope=properties.route_scope,
            source_urls=[f'https://www.openstreetmap.org/{source.id}' for source in properties.sources],
            route=route, analysis=analysis,
            comparison=RouteComparison(
                original_flagged_m=original.totals.flagged_length_m,
                alternative_flagged_m=analysis.totals.flagged_length_m,
                added_distance_m=analysis.totals.length_m - original.totals.length_m,
                added_climb_ft=analysis.totals.climb_ft - original.totals.climb_ft,
                max_deviation_m=float(drawn.hausdorff_distance(line)),
            ),
            start_distance_m=start_distance, end_distance_m=end_distance,
        ))
    accepted.sort(key=lambda route: (
        route.comparison.max_deviation_m,
        route.start_distance_m + route.end_distance_m,
        max(0, route.comparison.added_distance_m),
        max(0, route.comparison.added_climb_ft), route.id,
    ))
    suggestions = accepted[:request.limit]
    return SuggestionsResponse(
        date=forecast.date, source=forecast.source,
        avoid_at_or_above=original.avoid_at_or_above,
        forced_by_warning=original.forced_by_warning,
        status='found' if suggestions else 'no_match',
        message=(
            'Nearby mapped sections meet the selected grade, distance, climb, and exposure limits.'
            if suggestions else 'No catalog section meets all selected limits. No limits were relaxed.'
        ),
        catalog=CatalogInfo(
            **catalog.model_dump(exclude={'type', 'features'}), feature_count=len(catalog.features)
        ),
        original_analysis=original, suggestions=suggestions, excluded=excluded,
        limitations=([WARNING_LIMITATION] if original.forced_by_warning else []) + LIMITATIONS,
    )
