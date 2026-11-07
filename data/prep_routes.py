"""Extract local ski touring sections from OpenSkiData's line-delimited GeoJSON export."""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

BBOX = (-111.80, 40.53, -111.55, 40.66)
ATTRIBUTION = (
    "Data from OpenSkiData / OpenSkiMap.org, © OpenStreetMap contributors (ODbL), "
    "Skimap.org, Who's On First, © Mapterhorn"
)


def extract(source: Path, destination: Path) -> None:
    features = []
    with source.open() as stream:
        for line in stream:
            # The upstream download writes each feature on its own line.
            if not line.lstrip().startswith('{"type":"Feature"'):
                continue
            feature = json.loads(line.rstrip().rstrip(','))
            properties = feature['properties']
            geometry = feature['geometry']
            if 'skitour' not in properties.get('uses', []) or geometry['type'] != 'LineString':
                continue
            points = geometry['coordinates']
            if len(points) < 2 or not all(
                BBOX[0] <= p[0] <= BBOX[2] and BBOX[1] <= p[1] <= BBOX[3] for p in points
            ):
                continue
            features.append({
                'type': 'Feature',
                'geometry': {'type': 'LineString', 'coordinates': [p[:2] for p in points]},
                'properties': {
                    'id': properties['id'],
                    'name': properties.get('name'),
                    'difficulty': properties.get('difficulty'),
                    'status': properties.get('status'),
                    'sources': properties['sources'],
                    'route_scope': 'mapped_section',
                    'oneway': properties.get('oneway'),
                },
            })
    if not features:
        raise ValueError('The export contains no local ski touring features. Check its format.')
    catalog = {
        'type': 'FeatureCollection',
        'source': 'OpenSkiData',
        'source_url': 'https://www.openskidata.org/',
        'retrieved_at': datetime.now(timezone.utc).isoformat(),
        'license': 'ODbL-1.0',
        'license_url': 'https://opendatacommons.org/licenses/odbl/1-0/',
        'attribution': ATTRIBUTION,
        'features': sorted(features, key=lambda f: f['properties']['id']),
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix('.tmp')
    temporary.write_text(json.dumps(catalog, indent=2) + '\n')
    temporary.replace(destination)
    print(f'Saved {len(features)} mapped ski touring sections to {destination}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).parent / 'routes/openskidata.geojson')
    args = parser.parse_args()
    extract(args.source, args.output)
