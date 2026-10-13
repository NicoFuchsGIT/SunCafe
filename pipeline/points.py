"""Phase 2.2: Messpunkte pro Ort aus data/wien.json, nach denselben Regeln wie js/shade.js.

OSM-Terrasse, sonst Punkte vor den Fassaden des eigenen Gebäudes, sonst die OSM-Position.
Koordinaten in Metern relativ zum Ort (x nach Osten, y nach Norden). Nur Standardbibliothek.
Aufruf: python3 pipeline/points.py [--buildings gebaeude.json] > punkte.json
"""
import argparse
import json
import math
import re
import sys
import urllib.parse

from spike_heights import OVERPASS, get

# wie js/config.js
SHADOW_REACH = 300
TERRACE_MATCH_RADIUS = 25
TERRACE_OFFSET = 4
BAD_CHAINS = ['der mann', 'aida', 'felber', 'ströck', 'stroeck', 'anker', 'tchibo', 'geier', 'admiral sportsbar', 'wild bean cafe']
BAD_CHAIN_RE = re.compile(r'(?<![^\W_])(' + '|'.join(BAD_CHAINS) + r')(?![^\W_])', re.I)

# wie js/geo.js
M_PER_DEG = 111320
SIDES = ['Nord', 'Nordost', 'Ost', 'Südost', 'Süd', 'Südwest', 'West', 'Nordwest']


def kx_at(lat):
    return M_PER_DEG * math.cos(math.radians(lat))


def poly_contains(pts, x, y):
    c, j = False, len(pts) - 1
    for i in range(len(pts)):
        (xi, yi), (xj, yj) = pts[i], pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def seg_dist(p):
    m = math.inf
    for i in range(len(p) - 1):
        ex, ey = p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]
        l2 = ex * ex + ey * ey
        s = max(0, min(1, -(p[i][0] * ex + p[i][1] * ey) / l2 if l2 else 0))
        m = min(m, math.hypot(p[i][0] + s * ex, p[i][1] + s * ey))
    return m


def ray_hits(x, y, dx, dy, max_d, blds):
    for b in blds:
        p = b['pts']
        for i in range(len(p) - 1):
            ax, ay = p[i][0] - x, p[i][1] - y
            ex, ey = p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]
            den = dx * ey - dy * ex
            if abs(den) < 1e-9:
                continue
            t, u = (ax * ey - ay * ex) / den, (ax * dy - ay * dx) / den
            if 0 <= u <= 1 and 0.05 < t <= max_d:
                return True
    return False


def side_name(nx, ny):
    # JS rundet .5 nach oben, Python zur geraden Zahl
    return 'Seite ' + SIDES[(math.floor(math.atan2(nx, ny) / (math.pi / 4) + 0.5) + 8) % 8]


# wie js/shade.js
def facade_points(own, near, owns):
    blds, p, edges = near + owns, own['pts'], []
    for i in range(len(p) - 1):
        ex, ey = p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]
        ln = math.hypot(ex, ey)
        if ln < 3:
            continue
        s = max(0, min(1, -(p[i][0] * ex + p[i][1] * ey) / (ln * ln)))
        qx, qy = p[i][0] + s * ex, p[i][1] + s * ey
        nx, ny = ey / ln, -ex / ln
        if poly_contains(p, qx + nx * 0.5, qy + ny * 0.5):  # Normale zeigt nach außen
            nx, ny = -nx, -ny
        edges.append({'qx': qx, 'qy': qy, 'nx': nx, 'ny': ny, 'd': math.hypot(qx, qy)})
    edges.sort(key=lambda e: e['d'])
    out = []
    for e in edges:
        if e['d'] > edges[0]['d'] + 25 or len(out) >= 4:
            break
        if any(o['nx'] * e['nx'] + o['ny'] * e['ny'] > 0.82 for o in out):  # fast gleiche Richtung
            continue
        x, y = e['qx'] + e['nx'] * TERRACE_OFFSET, e['qy'] + e['ny'] * TERRACE_OFFSET
        if any(poly_contains(b['pts'], x, y) for b in blds):  # Nachbarhaus an dieser Wand
            continue
        hits = sum(ray_hits(x, y, math.sin(k * math.pi / 4), math.cos(k * math.pi / 4), 25, blds) for k in range(8))
        out.append({'x': x, 'y': y, 'nx': e['nx'], 'ny': e['ny'], 'label': side_name(e['nx'], e['ny']),
                    'enclosed': hits >= 7, 'kind': 'facade'})
    opn = [o for o in out if not o['enclosed']]
    return opn or out


def terrace_points(c, kx, ky):
    if c['terr']:
        return [{'x': (t[1] - c['lng']) * kx, 'y': (t[0] - c['lat']) * ky, 'label': 'Terrasse (OSM)', 'kind': 'osm'}
                for t in c['terr']]
    if c['owns']:
        f = facade_points(c['owns'][0], c['near'], c['owns'])
        if f:
            return f
    return [{'x': 0, 'y': 0, 'label': 'Position laut OSM', 'kind': 'point'}]


def latlng(e):
    return e.get('lat', e.get('center', {}).get('lat')), e.get('lon', e.get('center', {}).get('lon'))


def parse_places(data):
    """Wie parseCafes in js/data.js mit ptype 'rest' (alle Ortsarten), Terrassen dem nächsten Ort zugeordnet."""
    places, terr = [], []
    for e in data['elements']:
        t = e.get('tags') or {}
        lat, lng = latlng(e)
        if lat is None:
            continue
        if t.get('leisure') == 'outdoor_seating' or t.get('amenity') == 'biergarten':
            terr.append((lat, lng))
        if (t.get('amenity') in ('cafe', 'bar', 'pub', 'restaurant') or t.get('shop') == 'bakery') \
                and not BAD_CHAIN_RE.search(t.get('name', '')):
            places.append({'id': str(e['id']), 'lat': lat, 'lng': lng, 'terr': []})
    for t in terr:
        best, bd = None, TERRACE_MATCH_RADIUS
        for c in places:
            d = math.hypot((t[1] - c['lng']) * kx_at(c['lat']), (t[0] - c['lat']) * M_PER_DEG)
            if d < bd:
                bd, best = d, c
        if best:
            best['terr'].append(t)
    return places


def attach_points(places, buildings):
    """Wie attachBuildings in js/shade.js; buildings: Overpass-Ways mit geometry."""
    # Raster über den ersten Eckpunkt, Zelle so groß wie die Suchbox des Clients
    cell = (SHADOW_REACH + 150) / M_PER_DEG
    grid = {}
    for b in buildings:
        if b.get('type') == 'way' and (b.get('tags') or {}).get('building') and b.get('geometry'):
            g0 = b['geometry'][0]
            grid.setdefault((int(g0['lat'] // cell), int(g0['lon'] // cell)), []).append(b['geometry'])
    for c in places:
        kx, ky = kx_at(c['lat']), M_PER_DEG
        ci, cj, dj = int(c['lat'] // cell), int(c['lng'] // cell), math.ceil(ky / kx)
        c['owns'], near = [], []
        for i in range(ci - 1, ci + 2):
            for j in range(cj - dj - 1, cj + dj + 2):
                for g in grid.get((i, j), ()):
                    if abs((g[0]['lon'] - c['lng']) * kx) > SHADOW_REACH + 150 or abs((g[0]['lat'] - c['lat']) * ky) > SHADOW_REACH + 150:
                        continue
                    pts = [((p['lon'] - c['lng']) * kx, (p['lat'] - c['lat']) * ky) for p in g]
                    if not any(abs(x) < SHADOW_REACH and abs(y) < SHADOW_REACH for x, y in pts):
                        continue
                    if poly_contains(pts, 0, 0):
                        c['owns'].append({'pts': pts})
                    elif seg_dist(pts) < 45:
                        near.append({'pts': pts})
        c['near'] = near
        c['pts'] = terrace_points(c, kx, ky)
    return {c['id']: [{k: round(v, 2) if isinstance(v, float) else v for k, v in p.items()} for p in c['pts']]
            for c in places}


def fetch_buildings(places):
    pad = (SHADOW_REACH + 150) / M_PER_DEG
    s, n = min(c['lat'] for c in places) - pad, max(c['lat'] for c in places) + pad
    w, e = min(c['lng'] for c in places) - 2 * pad, max(c['lng'] for c in places) + 2 * pad
    q = f'[out:json][timeout:600];way["building"]({s},{w},{n},{e});out tags geom;'
    return get(OVERPASS, urllib.parse.urlencode({'data': q}).encode())['elements']


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--places', default='data/wien.json', help='Orte als Overpass-JSON')
    ap.add_argument('--buildings', help='Gebäude als Overpass-JSON (out geom); ohne: live von Overpass')
    a = ap.parse_args()
    with open(a.places, encoding='utf-8') as f:
        places = parse_places(json.load(f))
    if not places:
        sys.exit(f'Keine Orte in {a.places}')
    if a.buildings:
        with open(a.buildings, encoding='utf-8') as f:
            buildings = json.load(f)['elements']
    else:
        buildings = fetch_buildings(places)
    json.dump(attach_points(places, buildings), sys.stdout, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()
