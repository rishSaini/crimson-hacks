"""RedRun API. Every endpoint is a stub that returns data from fixtures/ for now."""

import os
from datetime import date as Date
from pathlib import Path
from typing import TypeVar

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.models import (
    AlternativeRequest,
    AlternativeResponse,
    AnalyzeRequest,
    AnalyzeResponse,
    BriefingRequest,
    BriefingResponse,
    ForecastResponse,
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
    return load_fixture("forecast.response.json", ForecastResponse)


@app.post("/analyze")
def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    return load_fixture("analyze.response.json", AnalyzeResponse)


@app.post("/alternative")
def alternative(request: AlternativeRequest) -> AlternativeResponse:
    return load_fixture("alternative.response.json", AlternativeResponse)


@app.post("/briefing")
def briefing(request: BriefingRequest) -> BriefingResponse:
    return load_fixture("briefing.response.json", BriefingResponse)
