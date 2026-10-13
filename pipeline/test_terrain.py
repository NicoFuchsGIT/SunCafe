import struct
import unittest
import zlib

from terrain import decode_png, dem, terrarium


def png(rows, filters):
    """RGB-PNG mit vorgegebenem Filter je Zeile, Prädiktoren unabhängig von terrain.py nachgebaut."""
    def paeth(a, b, c):
        p = a + b - c
        return min((abs(p - a), 0, a), (abs(p - b), 1, b), (abs(p - c), 2, c))[2]
    raw, prev = b'', bytes(len(rows[0]))
    for f, row in zip(filters, rows):
        a = lambda i: row[i - 3] if i >= 3 else 0
        c = lambda i: prev[i - 3] if i >= 3 else 0
        pred = lambda i: [0, a(i), prev[i], (a(i) + prev[i]) // 2, paeth(a(i), prev[i], c(i))][f]
        raw += bytes([f]) + bytes((row[i] - pred(i)) & 255 for i in range(len(row)))
        prev = row
    chunk = lambda k, d: struct.pack('>I', len(d)) + k + d + struct.pack('>I', zlib.crc32(k + d))
    head = struct.pack('>IIBBBBB', len(rows[0]) // 3, len(rows), 8, 2, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', head) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


class TerrainTest(unittest.TestCase):
    def test_decode_all_filters(self):
        rows = [bytes((r * 37 + i * 91) % 256 for i in range(12)) for r in range(5)]
        self.assertEqual(decode_png(png(rows, [0, 1, 2, 3, 4]))[2], b''.join(rows))
        # 128,0,0 ≙ 0 m; 129,2,128 ≙ 258,5 m
        self.assertEqual(terrarium(png([bytes([128, 0, 0, 129, 2, 128])], [4])), [0, 258.5])

    def test_dem_is_bilinear_between_pixel_centres(self):
        # Höhe = Pixelspalte; Pixelmitte 0 liegt bei lng = -180 + 0,5 Pixel
        elev = dem(0, lambda z, x, y: [float(i % 256) for i in range(256 * 256)])
        self.assertAlmostEqual(elev(0, -180 + 360 / 256 * 10.75), 10.25)


if __name__ == '__main__':
    unittest.main()
