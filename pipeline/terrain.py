"""Gelände aus Terrarium-Höhenkacheln (AWS Open Data „Terrain Tiles“, in Österreich aus dem DGM 10 m).

Der WCS der Stadt Wien liefert keine Coverages, die GeoTIFF-Downloads bräuchten eine Zusatzbibliothek.
Die PNG-Kacheln lassen sich mit der Standardbibliothek lesen.
"""
import math
import struct
import urllib.request
import zlib

from spike_heights import UA

TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
NEAR_ZOOM, FAR_ZOOM = 13, 11  # in Wien ca. 13 m bzw. 51 m pro Pixel


def decode_png(data):
    """8-Bit-RGB/RGBA-PNG ohne Interlacing → (Breite, Kanäle, Pixelbytes zeilenweise)."""
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'kein PNG'
    pos, idat = 8, b''
    while pos < len(data):
        n, kind = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        if kind == b'IHDR':
            w, h, depth, color, _, _, interlace = struct.unpack('>IIBBBBB', body)
            assert depth == 8 and color in (2, 6) and not interlace, f'PNG-Format nicht unterstützt: {depth}/{color}/{interlace}'
        elif kind == b'IDAT':
            idat += body
        pos += n + 12
    raw, bpp = zlib.decompress(idat), 3 if color == 2 else 4
    stride, out, prev = w * bpp, bytearray(), bytearray(w * bpp)
    for r in range(h):
        f, row = raw[r * (stride + 1)], bytearray(raw[r * (stride + 1) + 1:(r + 1) * (stride + 1)])
        for i in range(stride):
            a = row[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if f == 1:
                row[i] = (row[i] + a) & 255
            elif f == 2:
                row[i] = (row[i] + b) & 255
            elif f == 3:
                row[i] = (row[i] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                row[i] = (row[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out += row
        prev = row
    return w, bpp, out


def terrarium(png):
    """Höhen in m ü. A. zeilenweise; Terrarium kodiert R·256 + G + B/256 − 32768."""
    w, bpp, px = decode_png(png)
    return [px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768 for i in range(0, len(px), bpp)]


def fetch_tile(z, x, y):
    req = urllib.request.Request(TILES.format(z=z, x=x, y=y), headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return terrarium(r.read())


def dem(z, fetch=fetch_tile):
    """Höhe(lat, lng) bilinear aus den Kacheln einer Zoomstufe; Kacheln werden bei Bedarf geladen."""
    tiles, n = {}, 256 * 2 ** z

    def at(x, y):
        k = (x >> 8, y >> 8)
        if k not in tiles:
            tiles[k] = fetch(z, *k)
        return tiles[k][(y & 255) * 256 + (x & 255)]

    def elev(lat, lng):
        # Pixelmitten liegen bei +0,5 im Web-Mercator-Pixelraster
        px = (lng + 180) / 360 * n - 0.5
        py = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n - 0.5
        x, y = math.floor(px), math.floor(py)
        fx, fy = px - x, py - y
        return ((at(x, y) * (1 - fx) + at(x + 1, y) * fx) * (1 - fy)
                + (at(x, y + 1) * (1 - fx) + at(x + 1, y + 1) * fx) * fy)
    return elev
