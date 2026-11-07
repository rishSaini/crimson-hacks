"""Danger rose decoding."""

import json

import pytest
from fastapi.testclient import TestClient

from app.forecast import decode_rose, effective_avoid_at_or_above, ratings_issued
from app.main import FIXTURES_DIR, app
from app.models import ForecastResponse

client = TestClient(app)


@pytest.mark.parametrize(
    "value, danger, pockets",
    [
        (0, "no_rating", False),
        (1, "low", True),
        (2, "low", False),
        (3, "moderate", True),
        (4, "moderate", False),
        (5, "considerable", True),
        (6, "considerable", False),
        (7, "high", True),
        (8, "high", False),
        (9, "extreme", True),
        (10, "extreme", False),
    ],
)
def test_decodes_each_value(value, danger, pockets):
    cell = decode_rose([value] * 24)[0]
    assert (cell.value, cell.danger, cell.pockets) == (value, danger, pockets)


@pytest.mark.parametrize(
    "index, band, aspect",
    [
        (0, "upper", "N"),
        (1, "upper", "NE"),
        (7, "upper", "NW"),
        (8, "mid", "N"),
        (10, "mid", "E"),
        (16, "lower", "N"),
        (23, "lower", "NW"),
    ],
)
def test_places_values_by_band_and_aspect(index, band, aspect):
    values = [0] * 24
    values[index] = 6
    cell = decode_rose(values)[index]
    assert (cell.index, cell.band, cell.aspect, cell.value) == (index, band, aspect, 6)


@pytest.mark.parametrize("length", [0, 23, 25])
def test_rejects_a_rose_of_the_wrong_length(length):
    with pytest.raises(ValueError):
        decode_rose([0] * length)


@pytest.mark.parametrize("value", [-1, 11])
def test_rejects_values_out_of_range(value):
    with pytest.raises(ValueError):
        decode_rose([value] + [0] * 23)


def test_ratings_issued_is_false_only_when_every_value_is_zero():
    assert ratings_issued([0] * 24) is False
    assert ratings_issued([0] * 23 + [1]) is True


@pytest.mark.parametrize(
    "name", ["forecast.response.json", "forecast.no_ratings.response.json"]
)
def test_decoding_reproduces_the_fixture_roses(name):
    body = json.loads((FIXTURES_DIR / name).read_text())
    values = [cell["value"] for cell in body["rose"]]
    assert [cell.model_dump() for cell in decode_rose(values)] == body["rose"]
    assert ratings_issued(values) == body["ratings_issued"]


@pytest.mark.parametrize("requested", ["considerable", "moderate", "low"])
def test_warning_forces_low_whatever_was_requested(requested):
    assert effective_avoid_at_or_above(requested, "warning") == ("low", True)


@pytest.mark.parametrize("alert_level", ["none", "watch", "special_bulletin"])
@pytest.mark.parametrize("requested", ["considerable", "moderate", "low"])
def test_other_alerts_keep_the_requested_setting(requested, alert_level):
    assert effective_avoid_at_or_above(requested, alert_level) == (requested, False)


# Verified against UAC's forecast page and its written danger summary for 2026-02-18.
FEB_18_ROSE = [
    8, 8, 8, 6, 6, 6, 6, 8,  # above 9,500 ft: N, NE, E, SE, S, SW, W, NW
    8, 8, 8, 6, 4, 4, 6, 8,  # 8,000 to 9,500 ft
    6, 6, 6, 4, 4, 4, 4, 6,  # below 8,000 ft
]


def demo_days() -> dict:
    return json.loads((FIXTURES_DIR / "demo_days.json").read_text())


def test_demo_days_match_the_forecast_model():
    for date, body in demo_days().items():
        forecast = ForecastResponse.model_validate(body)
        assert forecast.date.isoformat() == date
        assert forecast.source == "demo_replay"


def test_feb_18_rose_is_the_verified_rose():
    forecast = ForecastResponse.model_validate(demo_days()["2026-02-18"])
    assert [cell.value for cell in forecast.rose] == FEB_18_ROSE
    assert forecast.rose == decode_rose(FEB_18_ROSE)
    assert forecast.overall_danger == "high"


def test_feb_18_carries_its_avalanche_warning():
    alert = ForecastResponse.model_validate(demo_days()["2026-02-18"]).alert
    assert alert.level == "warning"
    assert alert.valid_from.isoformat() == "2026-02-18T06:00:00-07:00"
    assert alert.valid_to.isoformat() == "2026-02-19T06:00:00-07:00"
    assert alert.impacts.startswith("Recent heavy snow combined with strong wind")


# Verified against a screenshot of UAC's rose and its written danger summary for 2026-02-21.
FEB_21_ROSE = [
    6, 6, 6, 4, 4, 4, 6, 6,  # above 9,500 ft: N, NE, E, SE, S, SW, W, NW
    6, 6, 6, 4, 4, 4, 6, 6,  # 8,000 to 9,500 ft
    6, 6, 4, 4, 4, 4, 4, 6,  # below 8,000 ft
]


def test_feb_21_rose_is_the_verified_rose():
    forecast = ForecastResponse.model_validate(demo_days()["2026-02-21"])
    assert [cell.value for cell in forecast.rose] == FEB_21_ROSE
    assert forecast.rose == decode_rose(FEB_21_ROSE)
    assert forecast.overall_danger == "considerable"


def test_feb_21_carries_its_special_bulletin_verbatim():
    alert = ForecastResponse.model_validate(demo_days()["2026-02-21"]).alert
    assert alert.level == "special_bulletin"
    assert alert.what_to_do is None
    assert alert.what.startswith("The Utah Avalanche Center is warning of dangerous")
    assert "creating a HIGH avalanche danger across the entire state" in alert.what
    assert alert.where == "The mountains of Utah and southeastern Idaho."
    assert alert.impacts.startswith("Dangerous avalanche conditions exist in the backcountry")
    assert alert.valid_from.isoformat() == "2026-02-20T06:00:00-07:00"
    assert alert.valid_to.isoformat() == "2026-02-23T06:00:00-07:00"


def test_feb_21_comparison_advice_is_quoted_from_its_bottom_line():
    forecast = ForecastResponse.model_validate(demo_days()["2026-02-21"])
    assert "staying off of — and out from under — slopes steeper than 30" in (
        forecast.comparison_advice
    )
    assert forecast.comparison_advice in forecast.bottom_line
    assert ForecastResponse.model_validate(demo_days()["2026-02-18"]).comparison_advice is None


@pytest.mark.parametrize(
    "date, source, level",
    [
        ("2026-02-18", "demo_replay", "warning"),
        ("2026-02-21", "demo_replay", "special_bulletin"),
        ("2026-01-15", "fixture", "none"),
    ],
)
def test_forecast_endpoint_serves_saved_days(date, source, level):
    body = client.get("/forecast", params={"date": date}).json()
    assert (body["date"], body["source"], body["alert"]["level"]) == (date, source, level)


def test_forecast_endpoint_never_returns_another_days_forecast():
    assert client.get("/forecast", params={"date": "2026-03-01"}).status_code == 404


def test_forecast_endpoint_without_a_date_returns_the_labeled_sample():
    assert client.get("/forecast").json()["source"] == "fixture"


def analyze(date: str, setting: str = "considerable") -> dict:
    body = json.loads((FIXTURES_DIR / "analyze.request.json").read_text())
    response = client.post("/analyze", json={**body, "date": date, "avoid_at_or_above": setting})
    assert response.status_code == 200, response.text
    return response.json()


def test_warning_day_forces_low_through_the_api():
    body = analyze("2026-02-18")
    assert body["source"] == "demo_replay"
    assert (body["avoid_at_or_above"], body["forced_by_warning"]) == ("low", True)


@pytest.mark.parametrize("setting", ["considerable", "moderate", "low"])
def test_special_bulletin_day_keeps_the_users_setting(setting):
    body = analyze("2026-02-21", setting)
    assert body["source"] == "demo_replay"
    assert (body["avoid_at_or_above"], body["forced_by_warning"]) == (setting, False)


def test_analyze_returns_404_for_a_day_with_no_forecast():
    body = json.loads((FIXTURES_DIR / "analyze.request.json").read_text())
    response = client.post("/analyze", json={**body, "date": "2026-03-01"})
    assert response.status_code == 404
