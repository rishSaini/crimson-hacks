"""The API contract. Shared by all three roles: see "Ownership" in CLAUDE.md.

Units follow what the UI shows: distances in meters, elevation and climb in feet,
slope in degrees. Positions are GeoJSON order: [longitude, latitude].
"""

from datetime import date as Date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Aspect = Literal["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
ElevationBand = Literal["upper", "mid", "lower"]
DangerLevel = Literal["no_rating", "low", "moderate", "considerable", "high", "extreme"]

# "gray" means under 30 degrees: labeled "no avalanche-terrain flag", never "safe".
# "unrated" means 30 degrees or more with no forecast rating, drawn as a dashed
# magenta line with a "?" pin. No rating is not low danger, so it counts as flagged.
RouteColor = Literal["gray", "unrated", "green", "yellow", "orange", "red", "black"]

# For 30 degree terrain, each color has exactly one danger and flag state.
STEEP_COLOR_RULES: dict[str, tuple[str, bool]] = {
    "unrated": ("no_rating", True),
    "green": ("low", False),
    "yellow": ("moderate", False),
    "orange": ("considerable", True),
    "red": ("high", True),
    "black": ("extreme", True),
}

# Shown in the UI so stub or replayed data can never pass for today's forecast.
DataSource = Literal["uac_live", "demo_replay", "fixture"]

FlagReason = Literal["steep_terrain", "unrated_terrain", "overhead_exposure"]

# The lowest rating a reroute avoids. Unrated 30 degree terrain is always avoided.
AvoidThreshold = Literal["considerable", "moderate", "low"]
FallbackOption = Literal[
    "widen_corridor", "turnaround_point", "nearby_tours", "least_exposure_line"
]

Position = tuple[float, float]


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LineString(ApiModel):
    type: Literal["LineString"] = "LineString"
    coordinates: list[Position] = Field(min_length=2)


# --- GET /forecast -----------------------------------------------------------


class RoseCell(ApiModel):
    index: int = Field(ge=0, le=23, description="8 * band + octant")
    band: ElevationBand
    aspect: Aspect
    value: int = Field(ge=0, le=10, description="Raw UAC value")
    danger: DangerLevel = Field(description="Decoded: level = ceil(value / 2)")
    pockets: bool = Field(description='Odd raw values mean "pockets of" this level')


class AvalancheProblem(ApiModel):
    name: str
    description: str


class ForecastResponse(ApiModel):
    zone: str
    date: Date
    source: DataSource
    overall_danger: DangerLevel
    ratings_issued: bool = Field(
        description="False if all 24 rose values are 0: the UI shows the no-ratings banner"
    )
    rose: list[RoseCell] = Field(
        min_length=24,
        max_length=24,
        description="Upper N clockwise to NW, then mid, then lower",
    )
    problems: list[AvalancheProblem]
    bottom_line: str
    forecast_url: str

    @model_validator(mode="after")
    def rose_is_in_index_order(self) -> "ForecastResponse":
        if [cell.index for cell in self.rose] != list(range(24)):
            raise ValueError("rose cells must be in index order 0 to 23")
        if self.ratings_issued != any(cell.value > 0 for cell in self.rose):
            raise ValueError("ratings_issued must be false only if every rose value is 0")
        return self


# --- POST /analyze -----------------------------------------------------------


class AnalyzeRequest(ApiModel):
    route: LineString
    date: Date


class SegmentProperties(ApiModel):
    id: int = Field(description="1-based position along the route")
    length_m: float = Field(ge=0)
    slope_min_deg: float
    slope_max_deg: float
    elevation_min_ft: float
    elevation_max_ft: float
    aspects: list[Aspect] = Field(description="Merged segments can span several")
    danger: DangerLevel
    color: RouteColor
    flagged: bool = Field(
        description=(
            "Reroute target: 30 degrees or more that is rated Considerable or higher "
            "or unrated, or overhead exposure"
        )
    )
    flag_reason: FlagReason | None = None

    @model_validator(mode="after")
    def color_matches_flag(self) -> "SegmentProperties":
        if self.flagged != (self.flag_reason is not None):
            raise ValueError("flag_reason is required on flagged segments, and only on them")
        if self.color == "gray":
            if self.flagged and self.flag_reason != "overhead_exposure":
                raise ValueError("a gray segment can only be flagged for overhead exposure")
        elif (self.danger, self.flagged) != STEEP_COLOR_RULES[self.color]:
            raise ValueError(f"danger and flagged don't match color {self.color}")
        if (self.color == "unrated") != (self.flag_reason == "unrated_terrain"):
            raise ValueError("unrated_terrain is the flag reason for unrated segments only")
        return self


class SegmentFeature(ApiModel):
    type: Literal["Feature"] = "Feature"
    geometry: LineString
    properties: SegmentProperties


class SegmentCollection(ApiModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[SegmentFeature]


class RouteTotals(ApiModel):
    length_m: float = Field(ge=0)
    climb_ft: float = Field(ge=0)
    steep_segment_count: int = Field(
        ge=0, description="Segments of 30 degrees or more at any rating: all are listed"
    )
    steep_length_m: float = Field(ge=0)
    steep_ratings: list[DangerLevel] = Field(
        description="Ratings on those segments, lowest first, with no_rating before low"
    )
    flagged_length_m: float = Field(ge=0)
    flagged_stretch_count: int = Field(ge=0)
    max_flagged_danger: DangerLevel | None = Field(
        default=None, description="no_rating only if every flagged stretch is unrated"
    )


class AnalyzeResponse(ApiModel):
    date: Date
    source: DataSource
    segments: SegmentCollection
    totals: RouteTotals


# --- POST /alternative -------------------------------------------------------


class AlternativeRequest(ApiModel):
    route: LineString
    date: Date
    corridor_width_m: float = Field(
        default=400,
        ge=200,
        le=1500,
        description="Slider covers 200 to 800; fallback search widens to 1500",
    )
    avoid_at_or_above: AvoidThreshold = Field(
        default="considerable",
        description="Lowest rating to avoid. Unrated 30 degree terrain is always avoided",
    )


class RouteComparison(ApiModel):
    original_flagged_m: float = Field(
        ge=0, description="Meters in reroute targets under avoid_at_or_above"
    )
    alternative_flagged_m: float = Field(ge=0)
    added_distance_m: float
    added_climb_ft: float
    max_deviation_m: float = Field(ge=0, description="Hausdorff distance from original")


class AlternativeResponse(ApiModel):
    date: Date
    source: DataSource
    status: Literal["found", "no_line"]
    corridor_width_m: float
    avoid_at_or_above: AvoidThreshold
    message: str
    alternative: LineString | None = None
    comparison: RouteComparison | None = None
    fallbacks: list[FallbackOption] = Field(default_factory=list)
    turnaround_point: Position | None = None

    @model_validator(mode="after")
    def status_matches_payload(self) -> "AlternativeResponse":
        if self.status == "found":
            if self.alternative is None or self.comparison is None:
                raise ValueError("status 'found' needs alternative and comparison")
            comparison = self.comparison
            if comparison.alternative_flagged_m >= comparison.original_flagged_m:
                raise ValueError("an alternative is only shown if flagged meters dropped")
        elif self.alternative is not None or self.comparison is not None:
            raise ValueError("status 'no_line' must not carry a line or a comparison")
        return self


# --- POST /briefing ----------------------------------------------------------


class BriefingRequest(ApiModel):
    segments: SegmentCollection
    date: Date


class BriefingItem(ApiModel):
    segment_id: int
    avalanche_problem: str
    note: str


class BriefingResponse(ApiModel):
    date: Date
    source: DataSource
    items: list[BriefingItem]
