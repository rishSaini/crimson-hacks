"""Fetch OSM trails and ski areas once from Overpass, then commit the output in data/osm/.

Plan mode reads these: trails get a small cost bonus, and ski areas a penalty.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
from shapely.geometry import LineString, MultiPolygon, Polygon, mapping
from shapely.ops import polygonize, unary_union

# The terrain grid's extent, wider than BBOX_WGS84 in prep_dem.py.
SOUTH, WEST, NORTH, EAST = 40.49, -111.84, 40.70, -111.51
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OUTPUT_DIR = Path(__file__).resolve().parent / "osm"
ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"
QUERY = f"""
[out:json][timeout:120][bbox:{SOUTH},{WEST},{NORTH},{EAST}];
(
  way["highway"~"^(path|footway|track|bridleway)$"];
  way["piste:type"="skitour"];
  way["landuse"="winter_sports"];
  relation["landuse"="winter_sports"];
);
out geom;
"""


def line_coordinates(element: dict) -> list[list[float]]:
    return [[point["lon"], point["lat"]] for point in element.get("geometry", [])]


def area_geometry(element: dict) -> Polygon | MultiPolygon | None:
    """Build a ski area from a closed way, or from a relation's outer members."""
    if element["type"] == "way":
        points = line_coordinates(element)
        return Polygon(points) if len(points) >= 4 and points[0] == points[-1] else None
    outers = [
        LineString([[point["lon"], point["lat"]] for point in member["geometry"]])
        for member in element.get("members", [])
        if member.get("role") == "outer" and len(member.get("geometry", [])) >= 2
    ]
    polygons = list(polygonize(unary_union(outers))) if outers else []
    return unary_union(polygons) if polygons else None


def collection(features: list[dict], retrieved_at: str) -> dict:
    return {
        "type": "FeatureCollection",
        "source": "OpenStreetMap via Overpass",
        "retrieved_at": retrieved_at,
        "license": "ODbL-1.0",
        "attribution": ATTRIBUTION,
        "features": features,
    }


def main() -> None:
    response = httpx.post(
        OVERPASS_URL,
        data={"data": QUERY},
        headers={"User-Agent": "RedRun/0.1 (hackathon project)"},
        timeout=180,
    )
    response.raise_for_status()
    trails, areas = [], []
    for element in response.json()["elements"]:
        tags = element.get("tags", {})
        identity = {"id": f"{element['type']}/{element['id']}", "name": tags.get("name")}
        if tags.get("landuse") == "winter_sports":
            geometry = area_geometry(element)
            if geometry is not None and not geometry.is_empty:
                areas.append(
                    {"type": "Feature", "geometry": mapping(geometry), "properties": identity}
                )
        elif element["type"] == "way" and len(line_coordinates(element)) >= 2:
            trails.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": line_coordinates(element)},
                    "properties": {**identity, "highway": tags.get("highway")},
                }
            )
    if not trails or not areas:
        raise ValueError(f"Expected trails and ski areas, got {len(trails)} and {len(areas)}")

    retrieved_at = datetime.now(timezone.utc).isoformat()
    OUTPUT_DIR.mkdir(exist_ok=True)
    (OUTPUT_DIR / "trails.geojson").write_text(json.dumps(collection(trails, retrieved_at)) + "\n")
    (OUTPUT_DIR / "winter_sports.geojson").write_text(
        json.dumps(collection(areas, retrieved_at)) + "\n"
    )
    print(f"Saved {len(trails)} trails and {len(areas)} ski areas to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
