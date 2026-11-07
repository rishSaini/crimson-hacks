"""The assistant reads the request. Limits, flags, ranking and card numbers stay computed."""

import json
from datetime import date
from types import SimpleNamespace

import httpx2
import numpy as np
import openai
import pytest
from affine import Affine
from fastapi.testclient import TestClient

from app import main, route_agent
from app.models import ForecastResponse
from app.route_agent import (
    AgentRequest,
    AgentResponse,
    AgentUnavailable,
    MILLCREEK_NOTICE,
    NO_RATINGS_NOTICE,
    Tour,
    TourLibrary,
    reason_passes,
    suggest_tours,
    template_reason,
)
from app.route_analysis import TO_UTM, TerrainGrids, load_grids
from app.route_search import OsmLayers, load_osm

FEB_21, FEB_18 = date(2026, 2, 21), date(2026, 2, 18)
WARNING_LINE = "UAC recommends avoiding all avalanche terrain today."
LIBRARY_CHECKS = {}
FACTS = {"round_trip_m": 2256, "climb_ft": 270, "flagged_m": 872, "flagged_stretch_count": 2}


class FakeClient:
    """Answers with a scripted response, and records what was sent."""

    def __init__(self, answer=None, status="completed", text=None, refusal=False):
        self.requests = []
        body = text if text is not None else json.dumps(answer)
        part = (
            SimpleNamespace(type="refusal", refusal="No.")
            if refusal else SimpleNamespace(type="output_text", text=body)
        )
        self.reply = SimpleNamespace(
            status=status,
            output=[SimpleNamespace(type="message", content=[part])],
            output_text="" if refusal else body,
        )
        self.responses = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.requests.append(kwargs)
        return self.reply


def answer(picks=(), canyon=None, max_climb_ft=None, max_distance_m=None, in_scope=True):
    return {
        "in_scope": in_scope,
        "constraints": {
            "canyon": canyon, "max_climb_ft": max_climb_ft, "max_distance_m": max_distance_m,
        },
        "picks": [{"tour_id": tour_id, "reason": reason} for tour_id, reason in picks],
    }


def forecast_on(day: date) -> ForecastResponse:
    return main.get_forecast(date=day)


def run(client, day=FEB_21, prompt="A short tour please", **kwargs):
    request = AgentRequest(prompt=prompt, date=day, **kwargs)
    return suggest_tours(request, forecast_on(day), load_grids(), load_osm(), client)


@pytest.fixture(autouse=True)
def reuse_library_checks(monkeypatch):
    """Planning all 18 tours takes seconds, and the result only depends on the day and setting."""
    real = route_agent.check_tours

    def check(library, request, forecast, grids, osm):
        if len(library.tours) == 1:
            return real(library, request, forecast, grids, osm)
        key = (request.date, request.avoid_at_or_above)
        if key not in LIBRARY_CHECKS:
            LIBRARY_CHECKS[key] = real(library, request, forecast, grids, osm)
        return LIBRARY_CHECKS[key]

    monkeypatch.setattr(route_agent, "check_tours", check)


def card_ids(result):
    return [card.tour_id for card in result.cards]


# --- The library ---------------------------------------------------------------


def test_every_tour_point_is_a_vertex_of_its_osm_way():
    trails = json.loads((route_agent.API_DIR.parent / "data/osm/trails.geojson").read_text())
    ways = {
        feature["properties"]["id"]: {tuple(point) for point in feature["geometry"]["coordinates"]}
        for feature in trails["features"]
        if feature["geometry"]["type"] == "LineString"
    }
    for tour in route_agent.load_tours().tours:
        for point in (tour.trailhead, tour.objective):
            assert tuple(point.position) in ways[point.osm_way], tour.id


def test_every_tour_plans_on_the_real_terrain():
    request = AgentRequest(prompt="x", date=FEB_21)
    library = route_agent.load_tours()
    checked = route_agent.check_tours(library, request, forecast_on(FEB_21), load_grids(), load_osm())
    assert [item.tour.id for item in checked] == [tour.id for tour in library.tours]


def test_no_library_tour_claims_millcreek_until_terrain_covers_it():
    assert {tour.canyon for tour in route_agent.load_tours().tours} == {
        "big_cottonwood", "little_cottonwood",
    }


# --- What the model is sent ------------------------------------------------------


def test_request_uses_the_project_model_and_sends_no_coordinates():
    client = FakeClient(answer())
    run(client)
    sent = client.requests[0]
    assert sent["model"] == "gpt-6.1-sol"
    assert "A short tour please" in sent["input"]
    assert "position" not in sent["input"] and "-111." not in sent["input"]
    tour_ids = {tour.id for tour in route_agent.load_tours().tours}
    schema = sent["text"]["format"]["schema"]
    assert set(schema["properties"]["picks"]["items"]["properties"]["tour_id"]["enum"]) == tour_ids


def assert_strict_schema(schema):
    """OpenAI's strict mode needs closed objects that require every property."""
    if isinstance(schema, dict):
        if schema.get("type") == "object":
            assert schema["additionalProperties"] is False
            assert set(schema["required"]) == set(schema["properties"])
        for value in schema.values():
            assert_strict_schema(value)
    elif isinstance(schema, list):
        for value in schema:
            assert_strict_schema(value)


def test_schema_meets_strict_mode_rules():
    assert_strict_schema(route_agent.answer_schema(["a", "b"]))


def real_sdk_client(reply_status, reply_body):
    """The real OpenAI client, with a mock transport in place of the network."""
    sent = []

    def handler(http_request):
        sent.append((http_request.url.path, json.loads(http_request.content)))
        return httpx2.Response(reply_status, json=reply_body)

    client = openai.OpenAI(
        api_key="test", max_retries=0, http_client=httpx2.Client(transport=httpx2.MockTransport(handler))
    )
    return client, sent


def responses_body(content, status="completed"):
    return {
        "id": "resp_1", "object": "response", "created_at": 0, "model": "gpt-6.1-sol",
        "status": status, "error": None, "incomplete_details": None, "instructions": None,
        "metadata": {}, "parallel_tool_calls": True, "temperature": None, "tool_choice": "auto",
        "tools": [], "top_p": None,
        "output": [
            {"type": "reasoning", "id": "rs_1", "summary": []},
            {
                "type": "message", "id": "msg_1", "role": "assistant", "status": "completed",
                "content": [content],
            },
        ],
    }


def test_real_sdk_sends_the_documented_request_and_parses_the_reply():
    text = json.dumps(answer([("donut_falls", "It is short.")], canyon="big_cottonwood"))
    client, sent = real_sdk_client(
        200, responses_body({"type": "output_text", "text": text, "annotations": []})
    )
    result = run(client)
    path, body = sent[0]
    assert path.endswith("/responses")
    assert body["model"] == "gpt-6.1-sol"
    assert body["text"]["format"]["type"] == "json_schema"
    assert body["text"]["format"]["strict"] is True
    assert body["reasoning"] == {"effort": "medium"}
    assert "temperature" not in body and "top_p" not in body
    assert result.constraints.canyon == "big_cottonwood"
    assert result.cards[0].tour_id == "donut_falls"
    assert result.cards[0].reason_source == "assistant"


def test_real_sdk_refusal_is_unavailable():
    client, _ = real_sdk_client(200, responses_body({"type": "refusal", "refusal": "No."}))
    with pytest.raises(AgentUnavailable, match="declined"):
        run(client)


@pytest.mark.parametrize(
    "status, body, expected",
    [
        (429, {"error": {"code": "insufficient_quota", "message": "x"}}, "out of credits"),
        (429, {"error": {"code": "rate_limit_exceeded", "message": "x"}}, "busy"),
        (401, {"error": {"code": "invalid_api_key", "message": "x"}}, "401"),
        (500, {"error": {"message": "x"}}, "500"),
    ],
)
def test_real_sdk_errors_become_clear_messages(status, body, expected):
    client, _ = real_sdk_client(status, body)
    with pytest.raises(AgentUnavailable, match=expected):
        run(client)


# --- Limits and ranking ----------------------------------------------------------


def test_every_demo_day_tour_is_flagged_so_nothing_is_called_a_match():
    result = run(FakeClient(answer()))
    assert result.status == "no_match"
    assert result.cards and not any(card.matches for card in result.cards)
    assert all("flagged_terrain" in card.misses for card in result.cards)
    assert "no limits were relaxed" in result.message


def test_numbers_on_cards_come_from_analysis():
    client = FakeClient(answer([("donut_falls", "Short, with flagged terrain near the start.")]))
    card = run(client).cards[0]
    assert card.tour_id == "donut_falls"
    assert card.round_trip_m == pytest.approx(card.analysis.totals.length_m * 2)
    assert card.analysis.segments.features[0].geometry.coordinates[0] == pytest.approx(
        card.route.coordinates[0]
    )


def test_stated_limits_are_checked_by_the_server():
    result = run(FakeClient(answer(max_climb_ft=1000, max_distance_m=4000)))
    for card in result.cards:
        totals = card.analysis.totals
        assert ("max_climb_ft" in card.misses) == (totals.climb_ft > 1000)
        assert ("max_distance_m" in card.misses) == (totals.length_m * 2 > 4000)
    assert result.constraints.max_climb_ft == 1000


def test_impossible_limits_return_closest_options_and_echo_the_limit():
    result = run(FakeClient(answer(max_climb_ft=1, canyon="little_cottonwood")))
    assert result.status == "no_match"
    assert result.cards
    assert all("max_climb_ft" in card.misses for card in result.cards)
    assert result.constraints.max_climb_ft == 1
    # Donut Falls has fewer flagged meters, but a named canyon outranks them.
    assert all(card.canyon == "little_cottonwood" for card in result.cards)


def test_a_shortlist_cannot_hide_the_top_ranked_tour():
    # Donut Falls has the fewest flagged meters on Feb 21. The model picks only long tours.
    picks = [("mineral_fork", "Long."), ("days_fork", "Long."), ("white_pine", "Long."),
             ("lake_blanche", "Long.")]
    result = run(FakeClient(answer(picks)))
    assert "donut_falls" in card_ids(result)
    assert len(result.cards) == 3
    added = next(card for card in result.cards if card.tour_id == "donut_falls")
    assert added.reason_source == "redrun"
    assert added.reason.startswith("Added by RedRun")


def test_cards_rank_stated_limits_before_flagged_meters():
    # Twin Lakes Pass has more flagged meters than Donut Falls, but is in the requested canyon.
    result = run(FakeClient(answer(canyon="little_cottonwood")))
    assert result.cards[0].canyon == "little_cottonwood"
    assert "canyon" not in result.cards[0].misses
    assert all(card.canyon == "little_cottonwood" for card in result.cards)


def test_tour_ids_the_library_does_not_have_are_dropped():
    result = run(FakeClient(answer([("made_up_tour", "Invented.")])))
    assert "made_up_tour" not in card_ids(result)
    assert result.cards


def small_library():
    start = TO_UTM.transform(430505, 4499505, direction="INVERSE")
    end = TO_UTM.transform(431005, 4499505, direction="INVERSE")
    return TourLibrary(
        source="test", attribution="test",
        tours=[Tour(id="flat", name="Flat", canyon="big_cottonwood",
                    trailhead={"osm_way": "way/1", "position": start},
                    objective={"osm_way": "way/1", "position": end})],
    )


def flat_grids():
    elevation = np.full((201, 201), 2000.0)
    return TerrainGrids(
        Affine(10, 0, 430000, 0, -10, 4500000), elevation,
        np.zeros_like(elevation), np.zeros_like(elevation),
    )


def fixture_forecast():
    return ForecastResponse.model_validate_json(
        (main.FIXTURES_DIR / "forecast.response.json").read_text()
    )


@pytest.fixture
def small(monkeypatch):
    monkeypatch.setattr(route_agent, "load_tours", small_library)


def test_found_needs_a_tour_with_no_flags(small):
    forecast = fixture_forecast()
    result = suggest_tours(
        AgentRequest(prompt="flat please", date=forecast.date), forecast, flat_grids(),
        OsmLayers((), ()), FakeClient(answer([("flat", "No flags found on this line.")])),
    )
    assert result.status == "found"
    assert result.cards[0].matches is True
    assert result.source == "fixture"
    assert "go/no-go" in result.message


def test_no_ratings_day_adds_the_banner(small):
    forecast = fixture_forecast()
    for cell in forecast.rose:
        cell.value, cell.danger, cell.pockets = 0, "no_rating", False
    forecast.ratings_issued = False
    result = suggest_tours(
        AgentRequest(prompt="flat please", date=forecast.date), forecast, flat_grids(),
        OsmLayers((), ()), FakeClient(answer()),
    )
    assert NO_RATINGS_NOTICE in result.notices


# --- Alerts and scope ------------------------------------------------------------


def test_warning_day_forces_low_and_never_changes_the_requested_setting():
    client = FakeClient(answer())
    result = run(client, day=FEB_18, avoid_at_or_above="considerable")
    assert (result.avoid_at_or_above, result.forced_by_warning) == ("low", True)
    assert result.message.startswith(WARNING_LINE)
    assert result.limitations[0] == WARNING_LINE
    assert all(card.analysis.avoid_at_or_above == "low" for card in result.cards)


def test_feb_21_keeps_the_setting_and_carries_uac_words_verbatim():
    result = run(FakeClient(answer()))
    forecast = forecast_on(FEB_21)
    assert (result.avoid_at_or_above, result.forced_by_warning) == ("considerable", False)
    assert result.uac.bottom_line == forecast.bottom_line
    assert result.uac.comparison_advice == forecast.comparison_advice
    assert result.uac.forecast_url == forecast.forecast_url
    assert result.source == "demo_replay"


def test_millcreek_says_it_is_not_covered_and_offers_other_canyons():
    result = run(FakeClient(answer(canyon="millcreek")), prompt="Something in Millcreek")
    assert MILLCREEK_NOTICE in result.notices
    assert result.status == "no_match"
    assert all("canyon" in card.misses for card in result.cards)


def test_out_of_scope_returns_no_cards():
    picks = [("donut_falls", "Ignored.")]
    result = run(FakeClient(answer(picks, in_scope=False)), prompt="Write me a poem")
    assert result.status == "out_of_scope"
    assert result.cards == []


# --- Checking the model's sentences ----------------------------------------------


@pytest.mark.parametrize(
    "reason",
    [
        "This is the safest line today.",
        "A safer choice than the others.",
        "You can travel here safely.",
        "UAC says safer terrain is lower.",
        "This line is clear of avalanche terrain.",
        "It has no avalanche risk.",
        "Good to go today.",
        "This is a no-go today.",
        "It climbs 9999 ft.",
        "It starts near -111.68 and 40.57.",
        "It crosses two flagged stretches.",
        "",
    ],
)
def test_rejected_sentences(reason):
    assert not reason_passes(reason, FACTS, "a short tour")


@pytest.mark.parametrize(
    "reason",
    [
        "It climbs 270 ft over a 2256 m round trip.",
        "Flagged terrain covers 872 m of it, on slopes of 30 degrees or more.",
        "It stays under your 3,000 ft limit, with 2 flagged stretches.",
        "It is the shortest tour in the canyon you named.",
    ],
)
def test_accepted_sentences(reason):
    assert reason_passes(reason, FACTS, "under 3,000 ft")


def test_template_reasons_pass_their_own_checks():
    assert reason_passes(template_reason(FACTS), FACTS, "")
    clean = {**FACTS, "flagged_stretch_count": 0, "flagged_m": 0}
    assert template_reason(clean).startswith("No flags found on this route today.")
    assert reason_passes(template_reason(clean), clean, "")


def test_bad_sentence_falls_back_to_a_template_with_computed_numbers():
    client = FakeClient(answer([("donut_falls", "The safest tour, only 12 m long.")]))
    card = run(client).cards[0]
    assert card.reason_source == "redrun"
    assert "safe" not in card.reason.lower()
    assert str(round(card.analysis.totals.climb_ft)) in card.reason


def test_good_sentence_is_kept():
    client = FakeClient(answer([("donut_falls", "It is the shortest tour you could pick here.")]))
    card = run(client).cards[0]
    assert card.reason_source == "assistant"
    assert card.reason == "It is the shortest tour you could pick here."


# --- Failing honestly --------------------------------------------------------------


@pytest.mark.parametrize(
    "client",
    [
        FakeClient(refusal=True),
        FakeClient(answer(), status="incomplete"),
        FakeClient(text="not json"),
        FakeClient(answer(max_climb_ft=-5)),
    ],
)
def test_unusable_answers_raise_rather_than_guess(client):
    with pytest.raises(AgentUnavailable):
        run(client)


def test_endpoint_returns_503_without_an_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(route_agent, "load_dotenv", lambda *args, **kwargs: False)
    response = TestClient(main.app).post(
        "/agent", json={"prompt": "short tour", "date": "2026-02-21"}
    )
    assert response.status_code == 503
    assert "OPENAI_API_KEY" in response.json()["detail"]


def test_endpoint_returns_404_without_a_forecast():
    response = TestClient(main.app).post(
        "/agent", json={"prompt": "short tour", "date": "2020-01-01"}
    )
    assert response.status_code == 404


def test_endpoint_uses_computed_results(monkeypatch):
    client = FakeClient(answer([("donut_falls", "It is short.")]))
    monkeypatch.setattr(route_agent, "make_client", lambda: client)
    response = TestClient(main.app).post(
        "/agent", json={"prompt": "short tour", "date": "2026-02-21"}
    )
    assert response.status_code == 200, response.text
    AgentResponse.model_validate(response.json())


def test_agent_fixtures_match_contract():
    AgentRequest.model_validate_json((main.FIXTURES_DIR / "agent.request.json").read_text())
    body = AgentResponse.model_validate_json(
        (main.FIXTURES_DIR / "agent.response.json").read_text()
    )
    assert body.status == "no_match"
    assert body.source == "demo_replay"
