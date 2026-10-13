"""Aufruf: python3 -m unittest discover pipeline"""
import base64
import json
import math
import os
import tempfile
import unittest

import points
from points import BAD_CHAIN_RE, M_PER_DEG, attach_points, kx_at, parse_places, tile_key, write_tiles

LAT, LNG = 48.2, 16.37


def way(x0, y0, x1, y1, i=0):
    """Rechteck in Metern um (LAT, LNG) als Overpass-Way, ohne Höhenangabe (15 m)."""
    ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
    return {'type': 'way', 'id': i, 'tags': {'building': 'yes'},
            'geometry': [{'lat': LAT + y / M_PER_DEG, 'lon': LNG + x / kx_at(LAT)} for x, y in ring]}


def node(i, x=0, y=0, **tags):
    return {'type': 'node', 'id': i, 'lat': LAT + y / M_PER_DEG, 'lon': LNG + x / kx_at(LAT), 'tags': tags}


class PointsTest(unittest.TestCase):
    def test_osm_terrace_wins(self):
        places = parse_places({'elements': [node(1, amenity='cafe'), node(2, 10, 0, leisure='outdoor_seating')]})
        pts = attach_points(places, [way(-5, -5, 5, 5)])['1']
        pts[0].pop('mask')
        self.assertEqual(pts, [{'x': 10.0, 'y': 0.0, 'label': 'Terrasse (OSM)', 'kind': 'osm'}])

    def test_mask_uses_wien_height_before_osm(self):
        # Terrasse 5 m östlich der Hauswand: im Westen (Sektor 135) verdeckt, im Osten (Sektor 45) frei
        places = parse_places({'elements': [node(1, amenity='cafe'), node(2, 10, 0, leisure='outdoor_seating')]})
        q = lambda h: round(math.degrees(math.atan2(h - 1.2, 5)) / 90 * 255)
        for heights, h in (({}, 15), ({7: 30.0}, 30.0)):
            mask = attach_points(places, [way(-5, -5, 5, 5, 7)], heights)['1'][0]['mask']
            self.assertEqual((len(mask), mask[135], mask[45]), (180, q(h), 0))

    def test_terrain_lifts_buildings_and_adds_far_horizon(self):
        # Westhälfte 6 m höher (Hausgrund), ab 900 m nördlich ein 100-m-Hügel, dahinter (grobes Raster) flach
        near = lambda lat, lng: (6 if lng < LNG else 0) + (100 if lat > LAT + 900 / M_PER_DEG else 0)
        places = parse_places({'elements': [node(1, amenity='cafe'), node(2, 10, 0, leisure='outdoor_seating')]})
        mask = attach_points(places, [way(-5, -5, 5, 5)], terrain=(near, lambda lat, lng: 0))['1'][0]['mask']
        q = lambda h: round(math.degrees(math.atan2(h - 1.2, 5)) / 90 * 255)
        self.assertEqual((mask[135], mask[45]), (q(21), 0))
        self.assertAlmostEqual(mask[0], math.degrees(math.atan(98.8 / 910)) / 90 * 255, delta=1)

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
        self.assertEqual(attach_points(places, []), {'1': [{'x': 0, 'y': 0, 'label': 'Position laut OSM', 'kind': 'point',
                                                             'mask': [0] * 180}]})
        self.assertFalse(BAD_CHAIN_RE.search('Schmankerl'))

    def test_write_tiles_roundtrip_and_size_limit(self):
        places = parse_places({'elements': [node(1, amenity='cafe'), node(2, 10, 0, leisure='outdoor_seating')]})
        pts = attach_points(places, [way(-5, -5, 5, 5)])
        with tempfile.TemporaryDirectory() as d:
            write_tiles(pts, places, d)
            with open(os.path.join(d, tile_key(LAT, LNG) + '.json'), encoding='utf-8') as f:
                p = json.load(f)['1'][0]
            self.assertEqual((p['x'], p['y'], p['kind']), (10.0, 0.0, 'osm'))
            self.assertEqual(list(base64.b64decode(p['mask'])), pts['1'][0]['mask'])
            old, points.MAX_GZIP = points.MAX_GZIP, 10
            try:
                with self.assertRaises(SystemExit):
                    write_tiles(pts, places, os.path.join(d, 'neu'))
            finally:
                points.MAX_GZIP = old
            self.assertFalse(os.path.exists(os.path.join(d, 'neu')))  # nichts halb geschrieben


if __name__ == '__main__':
    unittest.main()
