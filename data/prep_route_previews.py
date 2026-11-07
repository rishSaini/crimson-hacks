"""Prepare source samples for map display. Split GPX lines at long point intervals."""

import json
from pathlib import Path
from xml.etree import ElementTree as ET

from pyproj import Geod

SAMPLES = Path(__file__).parent / "routes" / "source-samples"
GEOD = Geod(ellps="WGS84")
DISPLAY_GAP_M = 100


def ski_sample(filename: str, name: str, grade: str, topo: int) -> dict:
    root = ET.parse(SAMPLES / filename).getroot()
    sequences = [segment.findall("{*}trkpt") for segment in root.findall(".//{*}trkseg")]
    sequences += [route.findall("{*}rtept") for route in root.findall(".//{*}rte")]
    lines, gaps, all_points = [], [], []
    for sequence in sequences:
        points = [(float(p.attrib["lon"]), float(p.attrib["lat"])) for p in sequence]
        if not points:
            continue
        all_points.extend(points)
        line = [points[0]]
        for start, end in zip(points, points[1:]):
            distance = GEOD.inv(*start, *end)[2]
            if distance > DISPLAY_GAP_M:
                gaps.append(distance)
                lines.append(line)
                line = []
            line.append(end)
        lines.append(line)
    if len(all_points) < 2:
        raise ValueError(f"{filename} does not contain a route")
    return {
        "id": f"skitour-{topo}", "name": name, "grade": grade,
        "source": "Skitour · pierregr", "url": f"https://skitour.fr/topos/{topo}",
        "license": "CC BY-SA 4.0",
        "lines": lines, "points": len(all_points),
        "gapCount": len(gaps), "largestGapM": round(max(gaps, default=0)),
        "endpointGapM": round(GEOD.inv(*all_points[0], *all_points[-1])[2]),
    }


def forest_samples() -> list[dict]:
    source = json.loads((SAMPLES / "usfs-white-pine-trails.geojson").read_text())
    trails = {
        "1002": "White Pine", "1003": "Red Pine", "1004": "Maybird Gulch",
    }
    samples = []
    for number, name in trails.items():
        lines = [
            feature["geometry"]["coordinates"]
            for feature in source["features"] if feature["properties"]["trail_no"] == number
        ]
        if not lines:
            raise ValueError(f"No source geometry for Forest Service trail {number}")
        samples.append({
            "id": f"usfs-{number}", "name": name, "grade": None,
            "source": "USDA Forest Service",
            "url": "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0",
            "license": None, "lines": lines, "points": sum(map(len, lines)),
            "gapCount": None, "largestGapM": None, "endpointGapM": None,
        })
    return samples


if __name__ == "__main__":
    samples = [
        ski_sample("lake-peak-east-chute.gpx", "Lake Peak East Chute", "3.3 E1", 8619),
        ski_sample("lake-peak-north-couloir.gpx", "Lake Peak North Couloir", "4.2 E2", 8618),
        *forest_samples(),
    ]
    (SAMPLES / "previews.json").write_text(json.dumps(samples, separators=(",", ":")) + "\n")
