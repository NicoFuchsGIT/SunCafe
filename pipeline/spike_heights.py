"""Spike 2.1: Gebäudehöhen der Stadt Wien (Baukörpermodell) gegen OSM vergleichen.

Lädt beide Quellen für ein Rechteck um den 1. Bezirk, ordnet Wien-Baukörper den
OSM-Gebäuden zu (Schwerpunkt im OSM-Umriss) und gibt einen Markdown-Bericht aus.
Nur Standardbibliothek. Aufruf: python3 pipeline/spike_heights.py > bericht.md
"""
import argparse
import json
import statistics
import sys
import time
import urllib.parse
import urllib.request

# Innere Stadt als Rechteck (lon/lat), schneidet Randstücke der Nachbarbezirke mit
BBOX = (16.355, 48.200, 16.386, 48.2185)
WFS = 'https://data.wien.gv.at/daten/geo'
# wie .github/workflows/update-wien.yml: der Hauptserver antwortet oft mit 504
OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter',
            'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
UA = 'SunCafe-Spike/1.0 (https://github.com/NicoFuchsGIT/SunCafe)'
# wie js/config.js und js/shade.js
DEFAULT_HEIGHT = 15
LEVEL_HEIGHT = 3
CELL = 0.001  # Grad, Rasterweite für die Zuordnung


def get(url, data=None):
    req = urllib.request.Request(url, data=data, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def overpass(q, rounds=3):
    """Fragt die Server reihum, bis einer antwortet; der letzte Fehler wird weitergereicht."""
    data = urllib.parse.urlencode({'data': q}).encode()
    for r in range(rounds):
        for url in OVERPASS:
            try:
                res = get(url, data)
                if not res.get('remark'):  # Overpass meldet Laufzeitfehler im JSON statt per Status
                    return res['elements']
                err = RuntimeError(res['remark'])
            except Exception as e:  # noqa: BLE001 – Timeout, 429, 504, kaputtes JSON: nächster Server
                err = e
            print(f'Overpass {url}: {err}', file=sys.stderr)
            time.sleep(5)
        if r < rounds - 1:
            time.sleep(30)
    raise err


def fetch_wien(layer, bbox=BBOX):
    # WFS 1.0.0, damit GeoJSON in EPSG:4326 lon/lat-Reihenfolge kommt; ohne CRS-Suffix liest der Server die bbox im Landes-CRS
    q = {'service': 'WFS', 'request': 'GetFeature', 'version': '1.0.0', 'typeName': layer,
         'srsName': 'EPSG:4326', 'outputFormat': 'json', 'bbox': ','.join(map(str, bbox)) + ',EPSG:4326'}
    url = WFS + '?' + urllib.parse.urlencode(q)
    for wait in (10, 30, 90, None):  # der WFS lässt Verbindungen ab und zu ins Leere laufen
        try:
            return get(url)['features']
        except Exception as e:  # noqa: BLE001 – Timeout, 5xx, kaputtes JSON: später noch einmal
            if wait is None:
                raise
            print(f'WFS {bbox}: {e}, neuer Versuch in {wait} s', file=sys.stderr)
            time.sleep(wait)


def fetch_osm():
    w, s, e, n = BBOX
    q = f'[out:json][timeout:180];way["building"]({s},{w},{n},{e});out tags geom;'
    return overpass(q)


def outer_rings(geom):
    if geom['type'] == 'Polygon':
        return [geom['coordinates'][0]]
    if geom['type'] == 'MultiPolygon':
        return [p[0] for p in geom['coordinates']]
    return []


def centroid(ring):
    # shortcut: Eckpunkt-Mittel statt Flächenschwerpunkt, reicht für kleine Baukörper; bei Fehlzuordnungen auf Flächenschwerpunkt umstellen
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def inside(pt, ring):
    x, y = pt
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit


def osm_height(tags):
    """Höhe und Quelle nach derselben Regel wie js/shade.js."""
    try:
        return float(str(tags['height']).replace('m', '').strip()) or DEFAULT_HEIGHT, 'height'
    except (KeyError, ValueError):
        pass
    try:
        return float(tags['building:levels']) * LEVEL_HEIGHT or DEFAULT_HEIGHT, 'levels'
    except (KeyError, ValueError):
        return DEFAULT_HEIGHT, 'default'


def match(wien, osm, top, base):
    """Pro OSM-Gebäude die höchste Wien-Höhe der Baukörper, deren Schwerpunkt darin liegt.

    Max statt Mittel, weil für den Schatten der höchste Teil zählt.
    """
    grid = {}  # Raster über die Umriss-Boxen, sonst ist die Zuordnung für ganz Wien quadratisch
    for el in osm:
        ring = [(g['lon'], g['lat']) for g in el.get('geometry', [])]
        if len(ring) >= 3:
            xs, ys = [p[0] for p in ring], [p[1] for p in ring]
            way = (min(xs), min(ys), max(xs), max(ys), ring, el)
            for i in range(int(way[0] // CELL), int(way[2] // CELL) + 1):
                for j in range(int(way[1] // CELL), int(way[3] // CELL) + 1):
                    grid.setdefault((i, j), []).append(way)
    best = {}
    for f in wien:
        p = f['properties']
        if p.get(top) is None or p.get(base) is None:
            continue
        h = float(p[top]) - float(p[base])
        if h <= 0:
            continue
        for ring in outer_rings(f['geometry']):
            c = centroid(ring)
            for x0, y0, x1, y1, oring, el in grid.get((int(c[0] // CELL), int(c[1] // CELL)), ()):
                if x0 <= c[0] <= x1 and y0 <= c[1] <= y1 and inside(c, oring):
                    best[el['id']] = (max(h, best.get(el['id'], (0,))[0]), el)
                    break
    return [(h, el) for h, el in best.values()]


def stats(pairs):
    errs = [o - w for o, w in pairs]
    return (len(errs), statistics.median(abs(e) for e in errs), statistics.mean(errs),
            sum(abs(e) <= 3 for e in errs) / len(errs))


def report(wien, osm, matched, top, base):
    out = ['# Spike 2.1: Wien-Baukörpermodell vs. OSM (1. Bezirk)', '',
           f'Rechteck (lon/lat): {BBOX}', '',
           f'- Wien-Baukörper: {len(wien)}',
           f'- OSM-Gebäude (ways): {len(osm)}',
           f'- OSM-Gebäude mit zugeordneten Wien-Baukörpern: {len(matched)}',
           f'- Wien-Höhe = `{top}` − `{base}`', '']
    if wien:
        out += ['Attribute im Wien-Datensatz: ' + ', '.join(f'`{k}`' for k in wien[0]['properties']), '']
    by_src = {'height': [], 'levels': [], 'default': []}
    for w, el in matched:
        o, src = osm_height(el.get('tags', {}))
        by_src[src].append((o, w))
    out += ['| OSM-Quelle | n | Anteil | Median \\|Fehler\\| (m) | Mittel Fehler OSM−Wien (m) | Anteil ±3 m |',
            '|---|---|---|---|---|---|']
    rows = list(by_src.items()) + [('alle (Client-Regel)', sum(by_src.values(), [])),
                                  ('pauschal 15 m', [(DEFAULT_HEIGHT, w) for w, _ in matched])]
    for name, pairs in rows:
        if pairs:
            n, med, bias, ok = stats(pairs)
            out.append(f'| {name} | {n} | {n / len(matched):.0%} | {med:.1f} | {bias:+.1f} | {ok:.0%} |')
    if matched:
        hs = [w for w, _ in matched]
        out += ['', f'Wien-Höhen: Median {statistics.median(hs):.1f} m, '
                    f'Min {min(hs):.1f} m, Max {max(hs):.1f} m']
    return '\n'.join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--layer', default='ogdwien:FMZKBKMOGD', help='WFS-Layer Baukörpermodell')
    ap.add_argument('--top', default='O_KOTE', help='Attribut Oberkante (m ü. A.)')
    ap.add_argument('--base', default='HOEHE_DGM', help='Attribut Gelände (U_KOTE ist meist leer)')
    a = ap.parse_args()
    wien, osm = fetch_wien(a.layer), fetch_osm()
    if not wien or not osm:
        sys.exit(f'Leere Antwort: {len(wien)} Wien-Baukörper, {len(osm)} OSM-Gebäude')
    fields = wien[0]['properties']
    if a.top not in fields or a.base not in fields:
        sys.exit(f'Attribute {a.top}/{a.base} fehlen. Vorhanden: {", ".join(fields)}. '
                 'Mit --top/--base passende Felder angeben.')
    matched = match(wien, osm, a.top, a.base)
    if not matched:
        sys.exit('Keine Zuordnung zwischen Wien und OSM gefunden (Koordinatenreihenfolge prüfen)')
    print(report(wien, osm, matched, a.top, a.base))


if __name__ == '__main__':
    main()
