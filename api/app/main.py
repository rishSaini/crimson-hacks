"""RedRun API."""

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
)
from app.route_analysis import TerrainCoverageError, analyze_route, load_grids

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
    return load_fixture("forecast.response.json", ForecastResponse)


@app.post("/analyze")
def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    forecast = get_forecast(date=request.date)
    if forecast.date != request.date:
        raise HTTPException(404, "No forecast is available for the requested date.")
    try:
        grids = load_grids()
    except (RasterioIOError, ValueError) as error:
        raise HTTPException(503, "The terrain grids are unavailable.") from error
    try:
        return analyze_route(request, forecast, grids)
    except TerrainCoverageError as error:
        raise HTTPException(422, str(error)) from error


@app.post("/alternative")
def alternative(request: AlternativeRequest) -> AlternativeResponse:
    return load_fixture("alternative.response.json", AlternativeResponse)


@app.post("/briefing")
def briefing(request: BriefingRequest) -> BriefingResponse:
    return load_fixture("briefing.response.json", BriefingResponse)
