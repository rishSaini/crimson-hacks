"""Keeps fixtures, models and stubs in step. These should pass from day one."""

import json
import math
import re

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import FIXTURES_DIR, app
from app.models import (
    AlternativeRequest,
    AlternativeResponse,
    AnalyzeRequest,
    AnalyzeResponse,
    BriefingRequest,
    BriefingResponse,
    ForecastResponse,
    SegmentProperties,
)

client = TestClient(app)

BANDS = ["upper", "mid", "lower"]
ASPECTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
DANGER_BY_LEVEL = ["no_rating", "low", "moderate", "considerable", "high", "extreme"]


def fixture(name: str):
    return json.loads((FIXTURES_DIR / name).read_text())


@pytest.mark.parametrize(
    "name, model",
    [
        ("analyze.request.json", AnalyzeRequest),
        ("analyze.response.json", AnalyzeResponse),
        ("alternative.request.json", AlternativeRequest),
        ("alternative.response.json", AlternativeResponse),
        ("alternative.no_line.response.json", AlternativeResponse),
        ("briefing.request.json", BriefingRequest),
        ("briefing.response.json", BriefingResponse),
        ("analyze.unrated.response.json", AnalyzeResponse),
        ("analyze.low_only.response.json", AnalyzeResponse),
        ("analyze.moderate_only.response.json", AnalyzeResponse),
        ("analyze.low_moderate.response.json", AnalyzeResponse),
        ("alternative.avoid_low.request.json", AlternativeRequest),
        ("alternative.avoid_low.response.json", AlternativeResponse),
        ("forecast.response.json", ForecastResponse),
        ("forecast.no_ratings.response.json", ForecastResponse),
    ],
)
def test_fixture_matches_model(name, model):
    model.model_validate(fixture(name))


def test_get_forecast_returns_fixture():
    response = client.get("/forecast", params=fixture("forecast.request.json"))
    assert response.status_code == 200
    assert response.json() == fixture("forecast.response.json")


@pytest.mark.parametrize(
    "path, name",
    [("/alternative", "alternative"), ("/briefing", "briefing")],
)
def test_post_endpoint_returns_fixture(path, name):
    response = client.post(path, json=fixture(f"{name}.request.json"))
    assert response.status_code == 200
    assert response.json() == fixture(f"{name}.response.json")


def test_analyze_uses_route_geometry_and_preserves_forecast_source():
    request = fixture("analyze.request.json")
    response = client.post("/analyze", json=request)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["source"] == fixture("forecast.response.json")["source"]
    assert body["date"] == request["date"]
    segments = body["segments"]["features"]
    assert segments[0]["geometry"]["coordinates"][0] == pytest.approx(
        request["route"]["coordinates"][0]
    )
    assert segments[-1]["geometry"]["coordinates"][-1] == pytest.approx(
        request["route"]["coordinates"][-1]
    )
    assert body["totals"]["length_m"] == pytest.approx(
        sum(segment["properties"]["length_m"] for segment in segments)
    )

    request["route"]["coordinates"] = request["route"]["coordinates"][:2]
    shortened = client.post("/analyze", json=request)
    assert shortened.status_code == 200, shortened.text
    assert 0 < shortened.json()["totals"]["length_m"] < body["totals"]["length_m"]


def test_analyze_rejects_a_route_with_one_point():
    response = client.post(
        "/analyze",
        json={
            "route": {"type": "LineString", "coordinates": [[-111.6, 40.6]]},
            "date": "2026-01-15",
        },
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "name", ["forecast.response.json", "forecast.no_ratings.response.json"]
)
def test_forecast_fixture_rose_decodes_consistently(name):
    rose = fixture(name)["rose"]
    for index, cell in enumerate(rose):
        assert BANDS[index // 8] == cell["band"]
        assert ASPECTS[index % 8] == cell["aspect"]
        assert DANGER_BY_LEVEL[math.ceil(cell["value"] / 2)] == cell["danger"]
        assert cell["pockets"] == (cell["value"] % 2 == 1)


def test_ratings_issued_must_match_the_rose():
    body = fixture("forecast.no_ratings.response.json")
    body["ratings_issued"] = True
    with pytest.raises(ValidationError):
        ForecastResponse.model_validate(body)


def unrated_segment(**changes) -> dict:
    return {
        "id": 1,
        "length_m": 100,
        "slope_min_deg": 31,
        "slope_max_deg": 35,
        "elevation_min_ft": 9000,
        "elevation_max_ft": 9100,
        "aspects": ["N"],
        "danger": "no_rating",
        "color": "unrated",
        "flagged": True,
        "flag_reason": "unrated_terrain",
        **changes,
    }


def test_unrated_segment_counts_as_flagged():
    SegmentProperties.model_validate(unrated_segment())
    with pytest.raises(ValidationError):
        SegmentProperties.model_validate(unrated_segment(flagged=False, flag_reason=None))


def test_moderate_segment_is_listed_but_not_flagged():
    moderate = {"danger": "moderate", "color": "yellow"}
    SegmentProperties.model_validate(
        unrated_segment(**moderate, flagged=False, flag_reason=None)
    )
    with pytest.raises(ValidationError):
        SegmentProperties.model_validate(
            unrated_segment(**moderate, flag_reason="steep_terrain")
        )


ALTERNATIVE_BODY = {
    "route": {"type": "LineString", "coordinates": [[-111.6, 40.6], [-111.7, 40.5]]},
    "date": "2026-01-15",
}


def test_avoid_at_or_above_defaults_to_considerable():
    request = AlternativeRequest.model_validate(ALTERNATIVE_BODY)
    assert request.avoid_at_or_above == "considerable"


@pytest.mark.parametrize("threshold", ["considerable", "moderate", "low"])
def test_alternative_accepts_each_threshold(threshold):
    body = {**ALTERNATIVE_BODY, "avoid_at_or_above": threshold}
    assert client.post("/alternative", json=body).status_code == 200


@pytest.mark.parametrize(
    "field", [{"avoid_at_or_above": "high"}, {"avoid_moderate": True}]
)
def test_alternative_rejects_other_thresholds_and_the_old_field(field):
    assert client.post("/alternative", json={**ALTERNATIVE_BODY, **field}).status_code == 422


def test_avoid_low_fixture_echoes_its_threshold():
    request = fixture("alternative.avoid_low.request.json")
    response = fixture("alternative.avoid_low.response.json")
    assert request["avoid_at_or_above"] == "low"
    assert response["avoid_at_or_above"] == "low"


@pytest.mark.parametrize(
    "name, ratings",
    [
        ("analyze.low_only.response.json", ["low"]),
        ("analyze.moderate_only.response.json", ["moderate"]),
        ("analyze.low_moderate.response.json", ["low", "moderate"]),
    ],
)
def test_unflagged_fixtures_name_the_ratings_present(name, ratings):
    totals = fixture(name)["totals"]
    assert totals["steep_ratings"] == ratings
    assert totals["steep_segment_count"] > 0
    assert totals["flagged_stretch_count"] == 0
    assert totals["max_flagged_danger"] is None


@pytest.mark.parametrize(
    "name",
    [
        "analyze.response.json",
        "analyze.unrated.response.json",
        "analyze.low_only.response.json",
        "analyze.moderate_only.response.json",
        "analyze.low_moderate.response.json",
    ],
)
def test_analyze_fixture_totals_match_segments(name):
    body = fixture(name)
    segments = [feature["properties"] for feature in body["segments"]["features"]]
    flagged = [segment for segment in segments if segment["flagged"]]
    steep = [segment for segment in segments if segment["color"] != "gray"]
    totals = body["totals"]
    assert totals["steep_segment_count"] == len(steep)
    assert totals["steep_length_m"] == sum(segment["length_m"] for segment in steep)
    assert totals["steep_ratings"] == sorted(
        {segment["danger"] for segment in steep}, key=DANGER_BY_LEVEL.index
    )
    assert all(segment["slope_max_deg"] >= 30 for segment in steep)
    assert totals["length_m"] == sum(segment["length_m"] for segment in segments)
    assert totals["flagged_length_m"] == sum(segment["length_m"] for segment in flagged)
    assert totals["flagged_stretch_count"] == len(flagged)
    assert [segment["id"] for segment in segments] == list(range(1, len(segments) + 1))


def test_briefing_fixture_only_cites_segments_it_was_given():
    request_ids = {
        feature["properties"]["id"]
        for feature in fixture("briefing.request.json")["segments"]["features"]
    }
    for item in fixture("briefing.response.json")["items"]:
        assert item["segment_id"] in request_ids


def test_fixtures_never_call_terrain_safe():
    for path in FIXTURES_DIR.glob("*.json"):
        assert not re.search(r"\bsafe\b", path.read_text(), re.IGNORECASE), path.name
