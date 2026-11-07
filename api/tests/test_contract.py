"""Keeps fixtures, models and stubs in step. These should pass from day one."""

import json
import math

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import FIXTURES_DIR, app
from app.models import (
    AlternativeRequest,
    AlternativeResponse,
    AnalyzeRequest,
    AnalyzeResponse,
    SAFE_LANGUAGE,
    BriefingItem,
    BriefingRequest,
    BriefingResponse,
    ForecastAlert,
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
        ("analyze.avoid_low.request.json", AnalyzeRequest),
        ("analyze.avoid_low.response.json", AnalyzeResponse),
        ("analyze.warning.response.json", AnalyzeResponse),
        ("alternative.warning.response.json", AlternativeResponse),
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
    [("/analyze", "analyze"), ("/alternative", "alternative"), ("/briefing", "briefing")],
)
def test_post_endpoint_returns_fixture(path, name):
    response = client.post(path, json=fixture(f"{name}.request.json"))
    assert response.status_code == 200
    assert response.json() == fixture(f"{name}.response.json")


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


def test_considerable_segment_is_flagged_at_every_setting():
    with pytest.raises(ValidationError):
        SegmentProperties.model_validate(
            unrated_segment(
                danger="considerable", color="orange", flagged=False, flag_reason=None
            )
        )


def with_yellow_flag(body: dict, flagged: bool) -> dict:
    for feature in body["segments"]["features"]:
        segment = feature["properties"]
        if segment["color"] == "yellow":
            segment["flagged"] = flagged
            segment["flag_reason"] = "steep_terrain" if flagged else None
    return body


@pytest.mark.parametrize(
    "setting, flagged, valid",
    [
        ("considerable", False, True),
        ("considerable", True, False),
        ("moderate", True, True),
        ("moderate", False, False),
    ],
)
def test_moderate_segment_is_flagged_only_at_moderate_or_low(setting, flagged, valid):
    body = with_yellow_flag(fixture("analyze.moderate_only.response.json"), flagged)
    body["avoid_at_or_above"] = setting
    if valid:
        AnalyzeResponse.model_validate(body)
    else:
        with pytest.raises(ValidationError):
            AnalyzeResponse.model_validate(body)


def test_same_route_flags_more_at_low():
    default = fixture("analyze.low_moderate.response.json")
    low = fixture("analyze.avoid_low.response.json")
    assert default["segments"]["features"][0]["geometry"] == low["segments"]["features"][0]["geometry"]
    assert default["avoid_at_or_above"] == "considerable"
    assert default["totals"]["flagged_stretch_count"] == 0
    assert low["avoid_at_or_above"] == "low"
    assert low["totals"]["flagged_stretch_count"] > 0


def test_low_setting_flags_overhead_exposure_from_rated_slopes():
    segments = fixture("analyze.avoid_low.response.json")["segments"]["features"]
    reasons = [feature["properties"]["flag_reason"] for feature in segments]
    assert "overhead_exposure" in reasons


def test_analyze_avoid_at_or_above_defaults_to_considerable():
    request = AnalyzeRequest.model_validate(
        {
            "route": {"type": "LineString", "coordinates": [[-111.6, 40.6], [-111.7, 40.5]]},
            "date": "2026-01-15",
        }
    )
    assert request.avoid_at_or_above == "considerable"


@pytest.mark.parametrize(
    "threshold, status", [("considerable", 200), ("moderate", 200), ("low", 200), ("high", 422)]
)
def test_analyze_accepts_only_the_three_thresholds(threshold, status):
    body = {**fixture("analyze.request.json"), "avoid_at_or_above": threshold}
    assert client.post("/analyze", json=body).status_code == status


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
        "analyze.avoid_low.response.json",
        "analyze.warning.response.json",
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


# Fields that hold UAC's words verbatim. Everything else is RedRun's own text.
UAC_QUOTED_KEYS = {"bottom_line", "problems", "alert"}
REPO_ROOT = FIXTURES_DIR.parent


def without_uac_text(value):
    if isinstance(value, dict):
        return {
            key: without_uac_text(item)
            for key, item in value.items()
            if key not in UAC_QUOTED_KEYS
        }
    if isinstance(value, list):
        return [without_uac_text(item) for item in value]
    return value


@pytest.mark.parametrize("path", sorted(FIXTURES_DIR.glob("*.json")), ids=lambda path: path.name)
def test_redrun_text_in_fixtures_never_calls_terrain_safe(path):
    redrun_text = json.dumps(without_uac_text(json.loads(path.read_text())))
    assert not SAFE_LANGUAGE.search(redrun_text)


def test_ui_source_never_calls_terrain_safe():
    sources = [
        path
        for folder in ("web/app", "web/components", "web/lib")
        for path in (REPO_ROOT / folder).rglob("*.ts*")
    ]
    assert sources
    for path in sources:
        assert not SAFE_LANGUAGE.search(path.read_text()), path.name


def test_quoted_uac_text_is_exempt():
    body = fixture("demo_days.json")["2026-02-18"]
    quoted = json.dumps({key: body[key] for key in UAC_QUOTED_KEYS})
    assert SAFE_LANGUAGE.search(quoted)
    ForecastResponse.model_validate(body)
    assert not SAFE_LANGUAGE.search(json.dumps(without_uac_text(body)))


def test_uac_text_is_stored_verbatim():
    body = fixture("demo_days.json")["2026-02-18"]
    assert "Find safer riding conditions on slopes less than 30° with no overhead hazard" in (
        body["alert"]["what_to_do"]
    )
    assert "If you're considering “safe” travel on a ridgeline" in (
        body["problems"][1]["description"]
    )


def test_redrun_field_outside_the_quoted_keys_is_still_checked():
    assert SAFE_LANGUAGE.search(json.dumps(without_uac_text({"message": "This is safe."})))


@pytest.mark.parametrize(
    "note",
    [
        "Segment 4 is safe today.",
        "This is a SAFE line.",
        "Segment 2 is safer than segment 4.",
        "Segment 1 is the safest choice.",
        "You can safely cross here.",
    ],
)
def test_llm_output_fails_on_safe(note):
    with pytest.raises(ValidationError):
        BriefingItem(segment_id=1, avalanche_problem="Wind Drifted Snow", note=note)


def test_llm_output_fails_even_when_quoting_uac():
    with pytest.raises(ValidationError):
        BriefingItem(
            segment_id=1,
            avalanche_problem="Persistent Weak Layer",
            note="UAC says to find safer riding conditions.",
        )


def test_llm_output_without_the_word_passes():
    BriefingItem(segment_id=1, avalanche_problem="Wind Drifted Snow", note="Look for cracking.")


def test_alternative_message_fails_on_safe():
    body = {**fixture("alternative.response.json"), "message": "This route is safe."}
    with pytest.raises(ValidationError):
        AlternativeResponse.model_validate(body)


def test_alert_none_carries_no_details():
    with pytest.raises(ValidationError):
        ForecastAlert(level="none", what="Something")


@pytest.mark.parametrize("level", ["watch", "warning", "special_bulletin"])
def test_alert_needs_all_details(level):
    with pytest.raises(ValidationError):
        ForecastAlert(level=level, what="Something")


def test_forecast_requires_an_alert():
    body = fixture("forecast.response.json")
    del body["alert"]
    with pytest.raises(ValidationError):
        ForecastResponse.model_validate(body)


@pytest.mark.parametrize(
    "name, model",
    [
        ("analyze.warning.response.json", AnalyzeResponse),
        ("alternative.warning.response.json", AlternativeResponse),
    ],
)
def test_warning_fixtures_are_forced_to_low(name, model):
    body = fixture(name)
    assert body["forced_by_warning"] is True
    assert body["avoid_at_or_above"] == "low"
    body["avoid_at_or_above"] = "considerable"
    with pytest.raises(ValidationError):
        model.model_validate(body)
