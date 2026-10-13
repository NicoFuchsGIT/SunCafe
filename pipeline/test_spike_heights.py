"""Aufruf: python3 -m unittest discover pipeline"""
import unittest

from spike_heights import match, osm_height, report

SQUARE = [(0, 0), (0.002, 0), (0.002, 0.002), (0, 0.002), (0, 0)]


def body(x, y, top, base=170):
    ring = [[x, y], [x + 0.0005, y], [x + 0.0005, y + 0.0005], [x, y + 0.0005], [x, y]]
    return {'geometry': {'type': 'Polygon', 'coordinates': [ring]},
            'properties': {'O_KOTE': top, 'U_KOTE': base}}


class SpikeTest(unittest.TestCase):
    def test_osm_height_follows_client_rule(self):
        self.assertEqual(osm_height({'height': '21 m'}), (21.0, 'height'))
        self.assertEqual(osm_height({'building:levels': '6'}), (18.0, 'levels'))
        self.assertEqual(osm_height({'height': 'hoch'}), (15, 'default'))
        self.assertEqual(osm_height({}), (15, 'default'))

    def test_match_takes_highest_body_inside_building(self):
        osm = [{'id': 1, 'tags': {'height': '20'}, 'geometry': [{'lon': x, 'lat': y} for x, y in SQUARE]}]
        wien = [body(0.0002, 0.0002, 185), body(0.0012, 0.0012, 195), body(0.005, 0.005, 200)]  # letzter liegt außerhalb
        m = match(wien, osm, 'O_KOTE', 'U_KOTE')
        self.assertEqual([(h, el['id']) for h, el in m], [(25.0, 1)])
        self.assertIn('| height | 1 | 100% | 5.0 | -5.0 | 0% |', report(wien, osm, m, 'O_KOTE', 'U_KOTE'))


if __name__ == '__main__':
    unittest.main()
