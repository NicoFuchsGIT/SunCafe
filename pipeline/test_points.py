"""Aufruf: python3 -m unittest discover pipeline"""
import unittest

from points import BAD_CHAIN_RE, M_PER_DEG, attach_points, kx_at, parse_places

LAT, LNG = 48.2, 16.37


def way(x0, y0, x1, y1):
    """Rechteck in Metern um (LAT, LNG) als Overpass-Way."""
    ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
    return {'type': 'way', 'tags': {'building': 'yes'},
            'geometry': [{'lat': LAT + y / M_PER_DEG, 'lon': LNG + x / kx_at(LAT)} for x, y in ring]}


def node(i, x=0, y=0, **tags):
    return {'type': 'node', 'id': i, 'lat': LAT + y / M_PER_DEG, 'lon': LNG + x / kx_at(LAT), 'tags': tags}


class PointsTest(unittest.TestCase):
    def test_osm_terrace_wins(self):
        places = parse_places({'elements': [node(1, amenity='cafe'), node(2, 10, 0, leisure='outdoor_seating')]})
        pts = attach_points(places, [way(-5, -5, 5, 5)])['1']
        self.assertEqual(pts, [{'x': 10.0, 'y': 0.0, 'label': 'Terrasse (OSM)', 'kind': 'osm'}])

    def test_facades_skip_neighbour_wall(self):
        # Café in 10×10-Haus, Nachbarhaus schließt im Osten direkt an
        places = parse_places({'elements': [node(1, amenity='cafe')]})
        pts = attach_points(places, [way(-5, -5, 5, 5), way(5, -5, 20, 5)])['1']
        self.assertEqual(sorted(p['label'] for p in pts), ['Seite Nord', 'Seite Süd', 'Seite West'])
        self.assertTrue(all(p['kind'] == 'facade' and not p['enclosed'] for p in pts))
        self.assertIn({'x': -9.0, 'y': 0.0}, [{'x': p['x'], 'y': p['y']} for p in pts])

    def test_fallback_and_filters(self):
        places = parse_places({'elements': [node(1, amenity='cafe'), node(2, shop='bakery', name='Ströck'),
                                            node(3, amenity='bank')]})
        self.assertEqual(attach_points(places, []), {'1': [{'x': 0, 'y': 0, 'label': 'Position laut OSM', 'kind': 'point'}]})
        self.assertFalse(BAD_CHAIN_RE.search('Schmankerl'))


if __name__ == '__main__':
    unittest.main()
