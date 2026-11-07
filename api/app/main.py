"""RedRun API."""

import json
import os
from datetime import date as Date
from pathlib import Path
from typing import TypeVar

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from rasterio.errors import RasterioIOError

from app.models import (
    AlternativeRequest,
    AlternativeResponse,
    AnalyzeRequest,
    AnalyzeResponse,
    BriefingRequest,
    BriefingResponse,
    ForecastResponse,
    PlanRequest,
    PlanResponse,
)
from app.route_analysis import TerrainCoverageError, TerrainGrids, analyze_route, load_grids
from app.route_planning import plan_route
from app.route_search import load_osm
from app.route_suggestions import (
    SuggestionsRequest, SuggestionsResponse, load_catalog, suggest_routes,
)

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"

ResponseModel = TypeVar("ResponseModel", bound=BaseModel)


def load_fixture(name: str, model: type[ResponseModel]) -> ResponseModel:
    """Read on every call, so fixture edits show up without a restart."""
    return model.model_validate_json((FIXTURES_DIR / name).read_text())


app = FastAPI(title="RedRun API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/forecast")
def get_forecast(zone: str = "salt-lake", date: Date | None = None) -> ForecastResponse:
    """Replay a saved demo day, or the sample forecast. Live UAC data needs an API token."""
    if date is not None:
        demo_days = json.loads((FIXTURES_DIR / "demo_days.json").read_text())
        if date.isoformat() in demo_days:
            return ForecastResponse.model_validate(demo_days[date.isoformat()])
    forecast = load_fixture("forecast.response.json", ForecastResponse)
    # Never hand back another day's forecast under the requested date.
    if date is not None and forecast.date != date:
        raise HTTPException(404, "No forecast is available for the requested date.")
    return forecast


@app.post("/analyze")
def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    forecast, grids = terrain_context(request.date)
    try:
        return analyze_route(request, forecast, grids)
    except TerrainCoverageError as error:
        raise HTTPException(422, str(error)) from error


def terrain_context(date: Date) -> tuple[ForecastResponse, TerrainGrids]:
    forecast = get_forecast(date=date)
    if forecast.date != date:
        raise HTTPException(404, "No forecast is available for the requested date.")
    try:
        grids = load_grids()
    except (RasterioIOError, ValueError) as error:
        raise HTTPException(503, "The terrain grids are unavailable.") from error
    return forecast, grids


@app.post("/suggestions")
def suggestions(request: SuggestionsRequest) -> SuggestionsResponse:
    forecast, grids = terrain_context(request.date)
    try:
        catalog = load_catalog()
    except (OSError, ValueError) as error:
        raise HTTPException(503, "The route catalog is unavailable.") from error
    try:
        return suggest_routes(request, forecast, grids, catalog)
    except TerrainCoverageError as error:
        raise HTTPException(422, str(error)) from error


@app.post("/plan")
def plan(request: PlanRequest) -> PlanResponse:
    forecast, grids = terrain_context(request.date)
    try:
        osm = load_osm()
    except (OSError, ValueError) as error:
        raise HTTPException(503, "The trail and ski area data is unavailable.") from error
    try:
        return plan_route(request, forecast, grids, osm)
    except TerrainCoverageError as error:
        raise HTTPException(422, str(error)) from error


@app.post("/alternative")
def alternative(request: AlternativeRequest) -> AlternativeResponse:
    return load_fixture("alternative.response.json", AlternativeResponse)


@app.post("/briefing")
def briefing(request: BriefingRequest) -> BriefingResponse:
    return load_fixture("briefing.response.json", BriefingResponse)
