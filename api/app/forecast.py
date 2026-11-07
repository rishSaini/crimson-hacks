"""Decoding for UAC's 24-value danger rose. Fetching isn't built yet: see tasks/forecast-ai.md."""

import math

from app.models import RoseCell

BANDS = ("upper", "mid", "lower")
ASPECTS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")
DANGER_BY_LEVEL = ("no_rating", "low", "moderate", "considerable", "high", "extreme")


def decode_rose(values: list[int]) -> list[RoseCell]:
    """Decode raw rose values, which run upper N clockwise to NW, then mid, then lower.

    Level is ceil(value / 2), odd values mean "pockets of" that level, and 0 is no rating.
    """
    if len(values) != 24:
        raise ValueError(f"a danger rose has 24 values, got {len(values)}")
    return [
        RoseCell(
            index=index,
            band=BANDS[index // 8],
            aspect=ASPECTS[index % 8],
            value=value,
            danger=DANGER_BY_LEVEL[math.ceil(value / 2)],
            pockets=value % 2 == 1,
        )
        for index, value in enumerate(_checked(values))
    ]


def ratings_issued(values: list[int]) -> bool:
    """False if all 24 values are 0, which triggers the no-ratings banner."""
    return any(_checked(values))


def effective_avoid_at_or_above(requested: str, alert_level: str) -> tuple[str, bool]:
    """The setting to apply for a forecast day, and whether a Warning forced it.

    An Avalanche Warning forces "low" for that forecast day only. This never touches
    the user's saved setting, which the next day's request sends again as usual.
    """
    if alert_level == "warning":
        return "low", True
    return requested, False


def _checked(values: list[int]) -> list[int]:
    for value in values:
        if not 0 <= value <= 10:
            raise ValueError(f"rose values run 0 to 10, got {value}")
    return values
