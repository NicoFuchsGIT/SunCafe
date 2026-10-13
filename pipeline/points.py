"""Phase 2.2/2.3: Messpunkte und Horizontmasken pro Ort aus data/wien.json, wie js/shade.js und js/horizon.js.

Messpunkte: OSM-Terrasse, sonst Punkte vor den Fassaden des eigenen Gebäudes, sonst die OSM-Position.
Koordinaten in Metern relativ zum Ort (x nach Osten, y nach Norden). Gebäudehöhen aus dem
Baukörpermodell der Stadt Wien, OSM-Höhe als Fallback. Nur Standardbibliothek.
Aufruf: python3 pipeline/points.py [--buildings gebaeude.json] [--wien baukoerper.json] [--out data/horizon] > punkte.json
Mit --out zusätzlich die Client-Kacheln (Phase 2.5, siehe write_tiles).
"""
import argparse
import base64
import gzip
import json
import math
import os
import re
import shutil
import sys

from spike_heights import fetch_wien, match, osm_height, overpass
from terrain import FAR_ZOOM, NEAR_ZOOM, dem

# wie js/config.js
SHADOW_REACH = 300
TERRACE_MATCH_RADIUS = 25
TERRACE_OFFSET = 4
EYE_HEIGHT = 1.2
HORIZON_SECTORS = 180
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


# wie js/horizon.js
SECTOR = 2 * math.pi / HORIZON_SECTORS
MASK_STEP = math.pi / 2 / 255


def horizon_mask(pt, blds, eye=0):
    """Pro Azimut-Sektor der größte Höhenwinkel der Gebäude als uint8 (0..255 ≙ 0..90°)."""
    mask, po = [0] * HORIZON_SECTORS, math.hypot(pt['x'], pt['y'])
    for b in blds:
        dh = b['h'] - eye
        if dh <= 0 or b['d'] - po > SHADOW_REACH or any(b is s for s in pt['skip']):
            continue
        p = b['pts']
        for i in range(len(p) - 1):
            ax, ay = p[i][0] - pt['x'], p[i][1] - pt['y']
            ex, ey = p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]
            # nur die Sektoren prüfen, deren Mittelstrahl zwischen den beiden Ecken liegt
            a0 = math.atan2(ax, ay)
            span = math.atan2(ax + ex, ay + ey) - a0
            if span > math.pi:
                span -= 2 * math.pi
            elif span < -math.pi:
                span += 2 * math.pi
            k0 = math.ceil((min(a0, a0 + span) - 1e-9) / SECTOR)
            k1 = math.floor((max(a0, a0 + span) + 1e-9) / SECTOR)
            for k in range(k0, k1 + 1):
                dx, dy = math.sin(k * SECTOR), math.cos(k * SECTOR)
                den = dx * ey - dy * ex
                if abs(den) < 1e-9:
                    continue
                t, u = (ax * ey - ay * ex) / den, (ax * dy - ay * dx) / den
                if u < 0 or u > 1 or t <= 0.05 or t > SHADOW_REACH:
                    continue
                q, s = math.floor(math.atan2(dh, t) / MASK_STEP + 0.5), k % HORIZON_SECTORS
                mask[s] = max(mask[s], q)
    return mask


TERRAIN_REACH = 20000
TERRAIN_FAR_FROM = 2000  # ab hier das grobe Raster
EARTH_R = 6371000
REFRACTION = 0.13


def terrain_mask(lat, lng, near, far, eye=EYE_HEIGHT):
    """Höhenwinkel des Geländes je Sektor bis 20 km, mit Erdkrümmung und Refraktion."""
    kx, z0, mask = kx_at(lat), near(lat, lng) + eye, [0] * HORIZON_SECTORS
    for s in range(HORIZON_SECTORS):
        dx, dy = math.sin(s * SECTOR), math.cos(s * SECTOR)
        best, d = 0, 10
        while d <= TERRAIN_REACH:
            z = (near if d < TERRAIN_FAR_FROM else far)(lat + dy * d / M_PER_DEG, lng + dx * d / kx)
            best = max(best, (z - z0 - d * d * (1 - REFRACTION) / (2 * EARTH_R)) / d)
            # shortcut: Schrittweite wächst mit der Entfernung (2,5 %), schmale Grate weit draußen können durchrutschen; bei Bedarf feiner
            d += max(10, d / 40)
        mask[s] = math.floor(math.atan(best) / MASK_STEP + 0.5)
    return mask


def attach_points(places, buildings, heights=None, eye=EYE_HEIGHT, terrain=None):
    """Wie attachBuildings in js/shade.js plus attachMasks in js/horizon.js.

    buildings: Overpass-Ways mit geometry; heights: OSM-ID → Wien-Höhe, sonst gilt die OSM-Höhe.
    terrain: (near, far) Höhe(lat, lng); dann zählen Geländehorizont und Geländeunterschied zu den Gebäuden.
    """
    heights, near = heights or {}, terrain[0] if terrain else (lambda lat, lng: 0)
    # Raster über den ersten Eckpunkt, Zelle so groß wie die Suchbox des Clients
    cell = (SHADOW_REACH + 150) / M_PER_DEG
    grid = {}
    for b in buildings:
        if b.get('type') == 'way' and (b.get('tags') or {}).get('building') and b.get('geometry'):
            g0 = b['geometry'][0]
            h = heights.get(b.get('id')) or osm_height(b['tags'])[0]
            grid.setdefault((int(g0['lat'] // cell), int(g0['lon'] // cell)), []).append((h + near(g0['lat'], g0['lon']), b['geometry']))
    for c in places:
        kx, ky = kx_at(c['lat']), M_PER_DEG
        ci, cj, dj = int(c['lat'] // cell), int(c['lng'] // cell), math.ceil(ky / kx)
        c['owns'], loc, z0 = [], [], near(c['lat'], c['lng'])
        for i in range(ci - 1, ci + 2):
            for j in range(cj - dj - 1, cj + dj + 2):
                for top, g in grid.get((i, j), ()):
                    h = top - z0
                    if abs((g[0]['lon'] - c['lng']) * kx) > SHADOW_REACH + 150 or abs((g[0]['lat'] - c['lat']) * ky) > SHADOW_REACH + 150:
                        continue
                    pts = [((p['lon'] - c['lng']) * kx, (p['lat'] - c['lat']) * ky) for p in g]
                    if not any(abs(x) < SHADOW_REACH and abs(y) < SHADOW_REACH for x, y in pts):
                        continue
                    if poly_contains(pts, 0, 0):
                        c['owns'].append({'h': h, 'pts': pts, 'd': 0})
                    else:
                        loc.append({'h': h, 'pts': pts, 'd': seg_dist(pts)})
        c['near'] = [b for b in loc if b['d'] < 45]
        c['pts'] = terrace_points(c, kx, ky)
        # shortcut: Geländehorizont einmal je Ort statt je Messpunkt (Punkte liegen ≤ 30 m auseinander); bei steilen Lagen je Punkt rechnen
        tm = terrain_mask(c['lat'], c['lng'], *terrain, eye) if terrain else None
        for pt in c['pts']:
            pt['skip'] = [b for b in c['near'] + c['owns'] if poly_contains(b['pts'], pt['x'], pt['y'])]
            pt['mask'] = horizon_mask(pt, loc + c['owns'], eye)  # das eigene Gebäude wirft Schatten auf die Terrasse
            if tm:
                pt['mask'] = list(map(max, pt['mask'], tm))
    return {c['id']: [{k: round(v, 2) if isinstance(v, float) else v for k, v in p.items() if k != 'skip'}
                      for p in c['pts']] for c in places}


TILE_DEG = 0.02  # Kachel ca. 2,2 × 1,5 km; wie js/horizon.js
MAX_GZIP = 2_000_000  # PRD F2.4


def tile_key(lat, lng):
    return f'{math.floor(lat / TILE_DEG)}_{math.floor(lng / TILE_DEG)}'


def write_tiles(pts, places, out_dir):
    """Messpunkte als Kacheln <out_dir>/<tile_key>.json: Ort-ID → [{x, y, label, kind, enclosed?, mask}].

    x, y auf 0,1 m gerundet, Maske als Base64 der 180 uint8. Bricht ab, bevor etwas geschrieben ist,
    wenn alle Kacheln zusammen gzip-komprimiert größer als MAX_GZIP wären. Ersetzt out_dir als Ganzes,
    damit keine veralteten Kacheln liegen bleiben.
    """
    tiles = {}
    for c in places:
        tiles.setdefault(tile_key(c['lat'], c['lng']), {})[c['id']] = [
            {'x': round(p['x'], 1), 'y': round(p['y'], 1), 'label': p['label'], 'kind': p['kind'],
             **({'enclosed': True} if p.get('enclosed') else {}),
             'mask': base64.b64encode(bytes(p['mask'])).decode()} for p in pts[c['id']]]
    blobs = {k: json.dumps(v, ensure_ascii=False, separators=(',', ':')).encode() for k, v in tiles.items()}
    size = sum(len(gzip.compress(b)) for b in blobs.values())
    if size > MAX_GZIP:
        raise SystemExit(f'Kacheln zu groß: {size} B gzip > {MAX_GZIP}')
    tmp = out_dir.rstrip('/') + '.neu'
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    for k, b in blobs.items():
        with open(os.path.join(tmp, k + '.json'), 'wb') as f:
            f.write(b)
    shutil.rmtree(out_dir, ignore_errors=True)
    os.replace(tmp, out_dir)
    return size


def count_places(out_dir):
    """Anzahl Orte in den bisherigen Kacheln, 0 wenn es keine gibt."""
    if not os.path.isdir(out_dir):
        return 0
    n = 0
    for name in os.listdir(out_dir):
        with open(os.path.join(out_dir, name), encoding='utf-8') as f:
            n += len(json.load(f))
    return n


def check(pts, n_buildings, n_heights, old_places=0):
    """Plausibilitätschecks vor dem Schreiben (PRD F2.6); bricht mit allen Befunden ab."""
    flat = sum(not any(any(p['mask']) for p in ps) for ps in pts.values())
    errs = [msg for bad, msg in [
        (n_buildings < 1000, f'nur {n_buildings} Gebäude von Overpass, Abruf wohl unvollständig'),
        (n_heights < n_buildings / 2, f'nur {n_heights} von {n_buildings} Gebäuden mit Wien-Höhe, WFS wohl ausgefallen'),
        (flat > len(pts) / 2, f'{flat} von {len(pts)} Orten ohne jeden Horizont, Gebäude fehlen wohl'),
        (len(pts) < old_places * 7 / 10, f'nur {len(pts)} Orte statt bisher {old_places} (< 70 %)'),
    ] if bad]
    if errs:
        raise SystemExit('Plausibilitätscheck fehlgeschlagen, alte Kacheln bleiben:\n- ' + '\n- '.join(errs))


def bbox(places):
    """(w, s, e, n) um alle Orte plus Schattenreichweite."""
    pad = (SHADOW_REACH + 150) / M_PER_DEG
    return (min(c['lng'] for c in places) - 2 * pad, min(c['lat'] for c in places) - pad,
            max(c['lng'] for c in places) + 2 * pad, max(c['lat'] for c in places) + pad)


def fetch_buildings(box):
    w, s, e, n = box
    q = f'[out:json][timeout:600];way["building"]({s},{w},{n},{e});out tags geom;'
    return overpass(q)


def fetch_wien_tiles(box, step=0.01):
    """Baukörper kachelweise (ca. 0,7 × 1,1 km), damit keine Antwort zu groß wird; Doppelte stören match nicht."""
    w, s, e, n = box
    for i in range(math.ceil((e - w) / step)):
        for j in range(math.ceil((n - s) / step)):
            x, y = w + i * step, s + j * step
            yield from fetch_wien('ogdwien:FMZKBKMOGD', (x, y, min(x + step, e), min(y + step, n)))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--places', default='data/wien.json', help='Orte als Overpass-JSON')
    ap.add_argument('--buildings', help='Gebäude als Overpass-JSON (out geom); ohne: live von Overpass')
    ap.add_argument('--wien', help='Baukörper als GeoJSON (WFS ogdwien:FMZKBKMOGD); ohne: live vom WFS')
    ap.add_argument('--out', help='Verzeichnis für die Client-Kacheln, z. B. data/horizon')
    a = ap.parse_args()
    with open(a.places, encoding='utf-8') as f:
        places = parse_places(json.load(f))
    if not places:
        sys.exit(f'Keine Orte in {a.places}')
    box = bbox(places)
    if a.buildings:
        with open(a.buildings, encoding='utf-8') as f:
            buildings = json.load(f)['elements']
    else:
        buildings = fetch_buildings(box)
    if a.wien:
        with open(a.wien, encoding='utf-8') as f:
            wien = json.load(f)['features']
    else:
        wien = fetch_wien_tiles(box)
    heights = {el['id']: h for h, el in match(wien, buildings, 'O_KOTE', 'HOEHE_DGM')}
    print(f'{len(heights)} von {len(buildings)} Gebäuden mit Wien-Höhe', file=sys.stderr)
    pts = attach_points(places, buildings, heights, terrain=(dem(NEAR_ZOOM), dem(FAR_ZOOM)))
    if a.out:
        check(pts, len(buildings), len(heights), count_places(a.out))
        print(f'Kacheln: {write_tiles(pts, places, a.out)} B gzip', file=sys.stderr)
    json.dump(pts, sys.stdout, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()
