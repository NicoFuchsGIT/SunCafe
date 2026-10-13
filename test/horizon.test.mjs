// Horizontmaske auf synthetischen Szenen. Koordinaten in Metern relativ zum Café (x Osten, y Norden).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {horizonMask, maskShade, sectorOf, attachMasks, MASK_STEP, tileKey, decodePoints} from '../js/horizon.js';
import {segDist} from '../js/geo.js';
import {SHADOW_REACH, HORIZON_SECTORS} from '../js/config.js';

const DEG = Math.PI / 180, N = 0, E = 90 * DEG, S = 180 * DEG;
const rect = (x0, y0, x1, y1, h = 15) => { const p = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]; return {h, pts: p, d: segDist(p)}; };
const at = (x, y, skip = []) => ({x, y, skip});
const angle = (mask, az) => mask[sectorOf(az)] * MASK_STEP;
const near = (a, b, tol = MASK_STEP) => assert.ok(Math.abs(a - b) <= tol, `${a / DEG}° statt ${b / DEG}°`);

test('sectorOf: 2°-Sektoren, um den Azimut zentriert, mit Umlauf', () => {
    assert.equal(HORIZON_SECTORS, 180);
    assert.equal(sectorOf(0), 0);
    assert.equal(sectorOf(S), 90);
    assert.equal(sectorOf(0.9 * DEG), 0);
    assert.equal(sectorOf(1.1 * DEG), 1);
    assert.equal(sectorOf(359.5 * DEG), 0);
    assert.equal(sectorOf(2 * Math.PI), 0);
    assert.equal(sectorOf(-90 * DEG), 135);
});

test('horizonMask: Uint8Array mit einem Wert je Sektor, ohne Gebäude leer', () => {
    const m = horizonMask(at(0, 0), []);
    assert.ok(m instanceof Uint8Array);
    assert.equal(m.length, HORIZON_SECTORS);
    assert.ok(m.every(v => v === 0));
});

test('horizonMask: Höhenwinkel einer Wand im Süden', () => {
    const m = horizonMask(at(0, 0), [rect(-10, -20, 10, -10, 20)]);
    near(angle(m, S), Math.atan2(20, 10));                      // senkrecht vor der Wand: 63,4°
    near(angle(m, S + 40 * DEG), Math.atan2(20, 10 / Math.cos(40 * DEG))); // schräg: weiter weg, flacher
    assert.equal(angle(m, N), 0);
    assert.equal(angle(m, E), 0);
    assert.equal(angle(m, S + 50 * DEG), 0);                    // Ecke liegt bei 45°
});

test('horizonMask: verdeckte Gebäude zählen mit dem größten Winkel', () => {
    const m = horizonMask(at(0, 0), [rect(-10, -20, 10, -10, 10), rect(-10, -60, 10, -40, 60)]);
    near(angle(m, S), Math.atan2(60, 40));
});

test('maskShade: gleiche Ergebnisse wie inShade in den Grundfällen', () => {
    const m = horizonMask(at(0, 0), [rect(-10, -20, 10, -10, 20)]);
    assert.equal(maskShade(m, 45 * DEG, S), true);
    assert.equal(maskShade(m, 60 * DEG, S), true);
    assert.equal(maskShade(m, 70 * DEG, S), false);
    assert.equal(maskShade(m, 45 * DEG, N), false);
    assert.equal(maskShade(m, 45 * DEG, E), false);
    assert.equal(maskShade(m, 45 * DEG, S - 2 * Math.PI), true); // Azimut außerhalb 0..2π
});

test('maskShade: Sonne unter dem Horizont wird auf 0,5° gesetzt', () => {
    const m = horizonMask(at(0, 0), [rect(-10, 100, 10, 120, 10)]); // 10 m hoch, 100 m entfernt: ≈ 5,7°
    assert.equal(maskShade(m, 10 * DEG, N), false);
    assert.equal(maskShade(m, -5 * DEG, N), true);
    assert.equal(maskShade(horizonMask(at(0, 0), []), -5 * DEG, N), false);
});

test('horizonMask: Gebäude, in dem der Punkt liegt (skip), wird ignoriert', () => {
    const b = rect(-10, -20, 10, -10, 20);
    assert.ok(horizonMask(at(0, 0, [b]), [b]).every(v => v === 0));
    assert.ok(horizonMask({x: 0, y: 0}, [b]).some(v => v > 0)); // ohne skip-Liste
});

test('horizonMask: nur Kanten bis SHADOW_REACH', () => {
    assert.ok(horizonMask(at(0, 0), [rect(-10, SHADOW_REACH + 50, 10, SHADOW_REACH + 70, 1000)]).every(v => v === 0));
    assert.ok(horizonMask(at(0, 0), [rect(-10, SHADOW_REACH - 50, 10, SHADOW_REACH - 30, 1000)])[0] > 0);
});

test('horizonMask: Messpunkt abseits des Café-Mittelpunkts', () => {
    const b = rect(-10, 100, 10, 120, 10);
    near(angle(horizonMask(at(0, 92), [b]), N), Math.atan2(10, 8));
    assert.equal(angle(horizonMask(at(15, 92), [b]), N), 0); // seitlich vorbei
});

test('horizonMask: Augenhöhe senkt die Verdeckung, niedrige Gebäude fallen weg', () => {
    const b = rect(-10, -20, 10, -10, 20);
    near(angle(horizonMask(at(0, 0), [b], 1.2), S), Math.atan2(18.8, 10));
    assert.ok(horizonMask(at(0, 0), [rect(-10, -20, 10, -10, 1)], 1.2).every(v => v === 0));
});

test('horizonMask: Wand rundum (Innenhof) verdeckt alle Sektoren', () => {
    const p = [[-20, -20], [-20, 20], [20, 20], [20, -20], [-20, -20]]; // Umlauf im Uhrzeigersinn
    const m = horizonMask(at(0, 0), [{h: 20, pts: p, d: segDist(p)}]);
    assert.ok(m.every(v => v > 0));
    near(angle(m, E), Math.atan2(20, 20));
    near(angle(m, 44 * DEG), Math.atan2(20, 20 / Math.cos(44 * DEG))); // Diagonale zur Ecke, trifft die Nordwand
});

test('attachMasks: Maske für jeden Messpunkt aus c.occ', () => {
    const b = rect(-10, -20, 10, -10, 20);
    const c = {occ: [b], pts: [at(0, 0), at(0, -15, [b])]};
    attachMasks(c);
    assert.equal(c.pts[0].mask.length, HORIZON_SECTORS);
    assert.equal(maskShade(c.pts[0].mask, 45 * DEG, S), true);
    assert.ok(c.pts[1].mask.every(v => v === 0));
});

test('decodePoints/tileKey: Kachelformat aus pipeline/points.py write_tiles', () => {
    const mask = new Uint8Array(HORIZON_SECTORS); mask[90] = 200;
    const b64 = Buffer.from(mask).toString('base64');
    const [p] = decodePoints([{x: 10, y: 0, label: 'Terrasse (OSM)', kind: 'osm', mask: b64}]);
    assert.deepEqual(p.mask, mask);
    assert.ok(maskShade(p.mask, 10 * DEG, S));
    assert.equal(decodePoints([{x: 0, y: 0, mask: 'AAAA'}]), null); // falsche Länge → Client rechnet selbst
    assert.equal(decodePoints([{x: 0, y: 0, mask: '%%'}]), null);
    assert.equal(decodePoints([]), null);
    assert.equal(tileKey(48.2, 16.37), '2410_818'); // wie tile_key in Python
});
