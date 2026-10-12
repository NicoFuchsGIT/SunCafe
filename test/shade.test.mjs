// Synthetische Szenen für die Schattenrechnung. Koordinaten in Metern relativ zum Café (x Osten, y Norden).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {facadePoints, inShade} from '../js/shade.js';
import {rayHits, segDist} from '../js/geo.js';
import {SHADOW_REACH} from '../js/config.js';

const DEG = Math.PI / 180, N = 0, E = 90 * DEG, S = 180 * DEG, W = 270 * DEG;
const ring = pts => pts.concat([pts[0]]);
const bld = (pts, h = 15) => { const p = ring(pts); return {h, pts: p, d: segDist(p)}; };
const rect = (x0, y0, x1, y1, h) => bld([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], h); // gegen den Uhrzeigersinn
const labels = pts => pts.map(p => p.label).sort();

// ---------- rayHits ----------
test('rayHits: Strahl trifft Gebäude in Blickrichtung innerhalb maxD', () => {
    const b = rect(10, -5, 20, 5);
    assert.equal(rayHits(0, 0, 1, 0, 25, [b]), true);
    assert.equal(rayHits(0, 0, Math.SQRT1_2, Math.SQRT1_2, 25, [rect(10, 10, 20, 20)]), true); // diagonal
});

test('rayHits: kein Treffer hinter dem Strahl, daneben oder jenseits von maxD', () => {
    const b = rect(10, -5, 20, 5);
    assert.equal(rayHits(0, 0, -1, 0, 25, [b]), false);
    assert.equal(rayHits(0, 0, 0, 1, 25, [b]), false);
    assert.equal(rayHits(0, 0, 1, 0, 9.9, [b]), false);
    assert.equal(rayHits(0, 0, 1, 0, 10, [b]), true); // Grenze inklusive
    assert.equal(rayHits(0, 0, 1, 0, 25, []), false);
});

test('rayHits: Startpunkt direkt an der Wand zählt nicht als Treffer nach außen', () => {
    const b = rect(10, -5, 20, 5);
    assert.equal(rayHits(10, 0, -1, 0, 25, [b]), false); // t <= 0.05 wird ignoriert
    assert.equal(rayHits(9.9, 0, 1, 0, 25, [b]), true);
});

test('rayHits: parallel zur Wand laufender Strahl', () => {
    assert.equal(rayHits(0, 5, 1, 0, 25, [bld([[10, 5], [20, 5], [20, 6]])]), true); // trifft erst die Schräge
    assert.equal(rayHits(0, 5, 1, 0, 25, [{pts: [[10, 5], [20, 5]]}]), false); // nur kollinear: kein Treffer
});

// ---------- facadePoints ----------
test('facadePoints: freistehendes Haus liefert vier Seiten mit 4 m Abstand', () => {
    const own = rect(-10, -10, 10, 10);
    const out = facadePoints(own, [], [own]);
    assert.deepEqual(labels(out), ['Seite Nord', 'Seite Ost', 'Seite Süd', 'Seite West']);
    const ost = out.find(p => p.label === 'Seite Ost');
    assert.ok(Math.abs(ost.x - 14) < 1e-9 && Math.abs(ost.y) < 1e-9);
    assert.ok(Math.abs(ost.nx - 1) < 1e-9 && Math.abs(ost.ny) < 1e-9);
    assert.ok(out.every(p => p.kind === 'facade' && !p.enclosed));
});

test('facadePoints: Normalen zeigen unabhängig von der Umlaufrichtung nach außen', () => {
    const cw = bld([[-10, -10], [-10, 10], [10, 10], [10, -10]]);
    const out = facadePoints(cw, [], [cw]);
    assert.deepEqual(labels(out), ['Seite Nord', 'Seite Ost', 'Seite Süd', 'Seite West']);
    for (const p of out) assert.ok(Math.max(Math.abs(p.x), Math.abs(p.y)) > 10, `${p.label} liegt außerhalb`);
});

test('facadePoints: Wand mit angebautem Nachbarhaus fällt weg', () => {
    const own = rect(-10, -10, 10, 10);
    const out = facadePoints(own, [rect(10, -10, 30, 10)], [own]);
    assert.deepEqual(labels(out), ['Seite Nord', 'Seite Süd', 'Seite West']);
});

test('facadePoints: gleiche Richtung nur einmal, höchstens vier Punkte', () => {
    // Stufe nach Osten: zwei Ostwände (x=10 und x=20) und zwei Südwände (y=-10 und y=2)
    const own = bld([[-10, -10], [10, -10], [10, 2], [20, 2], [20, 10], [-10, 10]]);
    const out = facadePoints(own, [], [own]);
    assert.deepEqual(labels(out), ['Seite Nord', 'Seite Ost', 'Seite Süd', 'Seite West']);
    assert.ok(Math.abs(out.find(p => p.label === 'Seite Ost').x - 14) < 1e-9, 'nähere Ostwand gewinnt');
    assert.ok(Math.abs(out.find(p => p.label === 'Seite Süd').y + 14) < 1e-9, 'nähere Südwand gewinnt');
});

test('facadePoints: eingeschlossene Seite (Hof) wird verworfen, wenn es offene gibt', () => {
    const own = rect(-10, -10, 10, 10);
    // Nordseite (0,14) rundum verbaut, Ost/West nur nach Norden hin
    const near = [rect(-20, 18, 20, 30), rect(12, 11, 30, 17), rect(-30, 11, -12, 17)];
    const out = facadePoints(own, near, [own]);
    assert.deepEqual(labels(out), ['Seite Ost', 'Seite Süd', 'Seite West']);
});

test('facadePoints: sind alle Seiten eingeschlossen, kommen alle zurück', () => {
    const own = rect(-10, -10, 10, 10);
    const near = [rect(-30, 18, 30, 30), rect(-30, -30, 30, -18), rect(18, -18, 30, 18), rect(-30, -18, -18, 18)];
    const out = facadePoints(own, near, [own]);
    assert.equal(out.length, 4);
    assert.ok(out.every(p => p.enclosed));
});

// ---------- inShade ----------
const at = (x, y, skip = []) => ({x, y, skip});

test('inShade: 20-m-Haus 10 m südlich wirft bei 45° Sonne aus Süden Schatten', () => {
    const c = {occ: [rect(-10, -20, 10, -10, 20)]};
    assert.equal(inShade(c, at(0, 0), 45 * DEG, S), true);
});

test('inShade: Sonne aus anderer Richtung oder zu hoch für die Entfernung', () => {
    const c = {occ: [rect(-10, -20, 10, -10, 20)]};
    assert.equal(inShade(c, at(0, 0), 45 * DEG, N), false);
    assert.equal(inShade(c, at(0, 0), 45 * DEG, E), false);
    assert.equal(inShade(c, at(0, 0), 70 * DEG, S), false); // Schattenlänge 20/tan(70°) ≈ 7,3 m < 10 m
    assert.equal(inShade(c, at(0, 0), 60 * DEG, S), true);  // ≈ 11,5 m
});

test('inShade: nahes Gebäude, aber die Wand in Sonnenrichtung liegt jenseits der Schattenlänge', () => {
    // nächste Ecke ≈ 3,6 m entfernt, die Wand nach Norden erst nach 30 m; Schattenlänge 10 m
    const c = {occ: [bld([[3, 2], [10, 2], [10, 40], [-10, 40], [-10, 30], [3, 30]], 10)]};
    assert.equal(inShade(c, at(0, 0), 45 * DEG, N), false);
    assert.equal(inShade(c, at(0, 0), 15 * DEG, N), true); // ≈ 37 m
});

test('inShade: Gebäude, in dem der Punkt liegt (skip), wird ignoriert', () => {
    const b = rect(-10, -20, 10, -10, 20);
    assert.equal(inShade({occ: [b]}, at(0, 0, [b]), 45 * DEG, S), false);
});

test('inShade: Schattenlänge ist auf SHADOW_REACH begrenzt', () => {
    const far = rect(-10, SHADOW_REACH + 50, 10, SHADOW_REACH + 70, 1000);
    const near = rect(-10, SHADOW_REACH - 50, 10, SHADOW_REACH - 30, 1000);
    assert.equal(inShade({occ: [far]}, at(0, 0), 5 * DEG, N), false);
    assert.equal(inShade({occ: [near]}, at(0, 0), 5 * DEG, N), true);
});

test('inShade: Sonne unter dem Horizont wird auf 0,5° gesetzt (langer Schatten)', () => {
    const c = {occ: [rect(-10, 100, 10, 120, 10)]}; // 10 m hoch, 100 m entfernt
    assert.equal(inShade(c, at(0, 0), 10 * DEG, N), false);
    assert.equal(inShade(c, at(0, 0), -5 * DEG, 2 * Math.PI), true); // az 360° = Norden
});

test('inShade: Terrassenpunkt abseits des Café-Mittelpunkts', () => {
    const c = {occ: [rect(-10, 100, 10, 120, 10)]};
    assert.equal(inShade(c, at(0, 0), 45 * DEG, N), false); // 100 m > 10 m Schattenlänge
    assert.equal(inShade(c, at(0, 92), 45 * DEG, N), true);  // nur 8 m entfernt
    assert.equal(inShade(c, at(15, 92), 45 * DEG, N), false); // seitlich vorbei
});

test('inShade: ohne Gebäude immer Sonne', () => {
    assert.equal(inShade({occ: []}, at(0, 0), 10 * DEG, S), false);
});
