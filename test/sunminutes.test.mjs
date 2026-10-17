import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sunTrack, sunMinutes, openSpans, sunSlots, bestWindow} from '../js/sunminutes.js';
import {HORIZON_SECTORS} from '../js/config.js';

const DEG = Math.PI / 180;
const T0 = new Date(Date.UTC(2026, 5, 21, 10, 0));
// Sonne im Süden (Kompass 180°), Höhe als Funktion der Minuten ab T0; SunCalc-Azimut ist ab Süden, also 0
const pos = altOf => d => ({altitude: altOf((d - T0) / 60000) * DEG, azimuth: 0});
const flat = () => new Uint8Array(HORIZON_SECTORS);
const wallSouth = deg => { const m = flat(); m[90] = Math.round(deg * DEG / (Math.PI / 2 / 255)); return m; };
const cafe = (...masks) => ({pts: masks.map(mask => ({mask}))});
// Fake von opening_hours: feste offene Zeiträume als [von, bis) in Minuten ab T0
const hours = (...spans) => ({getOpenIntervals: (from, to) => spans
    .map(([a, b]) => [new Date(Math.max(+T0 + a * 60000, +from)), new Date(Math.min(+T0 + b * 60000, +to)), false, undefined])
    .filter(([a, b]) => a < b)});

test('sunTrack: 2 h in 5-min-Schritten, Kompass-Azimut', () => {
    const tr = sunTrack(T0, pos(() => 30));
    assert.equal(tr.length, 24);
    assert.equal(tr[1].d - tr[0].d, 5 * 60000);
    assert.equal(tr.reduce((a, s) => a + s.min, 0), 120);
    assert.ok(Math.abs(tr[0].az - Math.PI) < 1e-12);
    assert.equal(tr[0].w, tr[0].d); // ohne Zeitzone bleibt die Zeit unverändert
});

test('sunTrack: letzter Schritt wird auf das Fenster gekürzt', () => {
    const tr = sunTrack(T0, pos(() => 30), null, 12, 5);
    assert.deepEqual(tr.map(s => s.min), [5, 5, 2]);
});

test('freie Sicht, offen: volles Fenster', () => {
    assert.equal(sunMinutes(cafe(flat()), sunTrack(T0, pos(() => 30))), 120);
});

test('Sonne unter dem Horizont zählt nicht', () => {
    assert.equal(sunMinutes(cafe(flat()), sunTrack(T0, pos(m => 10 - m / 6))), 65); // 10° → -10° in 2 h, Höhe ≥ 0 bis einschließlich Minute 60: 13 Schritte
});

test('Wand im Süden: nur Minuten über der Wand zählen', () => {
    // Sonne steigt von 10° auf 33°, Wand 20° (quantisiert 20,1°): Sonne erst ab dem Schritt bei Minute 55
    const mins = sunMinutes(cafe(wallSouth(20)), sunTrack(T0, pos(m => 10 + m / 5)));
    assert.equal(mins, 65);
});

test('ein sonniger Messpunkt reicht', () => {
    assert.equal(sunMinutes(cafe(wallSouth(60), flat()), sunTrack(T0, pos(() => 30))), 120);
    assert.equal(sunMinutes(cafe(wallSouth(60), wallSouth(45)), sunTrack(T0, pos(() => 30))), 0);
});

test('geschlossene Zeiten zählen nicht', () => {
    const c = cafe(flat());
    c.oh = hours([30, 600]); // öffnet nach 30 min
    assert.equal(sunMinutes(c, sunTrack(T0, pos(() => 30))), 90);
    c.oh = hours([0, 20], [60, 75]); // Mittagspause, Grenzen [von, bis)
    assert.equal(sunMinutes(c, sunTrack(T0, pos(() => 30))), 35);
    c.oh = hours();
    assert.equal(sunMinutes(c, sunTrack(T0, pos(() => 30))), 0);
});

test('fehlende oder unlesbare Öffnungszeiten zählen als offen', () => {
    const tr = sunTrack(T0, pos(() => 30));
    assert.equal(openSpans({}, tr), null);
    assert.equal(openSpans({oh: {getOpenIntervals: () => { throw new Error('x'); }}}, tr), null);
    const c = cafe(flat());
    c.oh = {getOpenIntervals: () => { throw new Error('x'); }};
    assert.equal(sunMinutes(c, tr), 120);
});

test('Öffnungszeiten: ein Aufruf pro Café, in Ortszeit, nur bei Sonne', () => {
    const calls = [];
    const c = cafe(flat());
    c.oh = {getOpenIntervals: (from, to) => { calls.push([from.getHours(), from.getMinutes(), to.getHours(), to.getMinutes()]); return [[from, to]]; }};
    assert.equal(sunMinutes(c, sunTrack(T0, pos(() => 30), 'Europe/Vienna')), 120);
    assert.deepEqual(calls, [[12, 0, 14, 0]]); // 10:00 UTC = 12:00 Sommerzeit, Fenster bis 14:00
    calls.length = 0;
    assert.equal(sunMinutes(cafe(wallSouth(60)), sunTrack(T0, pos(() => 30))), 0);
    const dark = cafe(wallSouth(60)); dark.oh = c.oh;
    sunMinutes(dark, sunTrack(T0, pos(() => 30)));
    assert.equal(calls.length, 0);
});

test('ohne Masken: null', () => {
    assert.equal(sunMinutes({}, sunTrack(T0, pos(() => 30))), null);
    assert.equal(sunMinutes({pts: [{}]}, sunTrack(T0, pos(() => 30))), null);
});

const slots = str => [...str].map((ch, i) => ({d: new Date(+T0 + i * 5 * 60000), min: 5, s: {S: 'sun', '-': 'shade', c: 'closed', n: 'night'}[ch]}));

test('sunSlots: Nacht, geschlossen, Sonne und Schatten pro Schritt', () => {
    const c = cafe(wallSouth(20));
    c.oh = hours([0, 50]);
    // Höhe -5°, 0°, 5° … 55°: unter 0° Nacht, bis 20,1° Schatten durch die Wand, ab Minute 50 geschlossen
    const s = sunSlots(c, sunTrack(T0, pos(m => m - 5), null, 60, 5)).map(x => x.s).join(',');
    assert.equal(s, 'night,shade,shade,shade,shade,shade,sun,sun,sun,sun,closed,closed');
    assert.equal(sunSlots({pts: [{}]}, []), null);
});

test('bestWindow: frühestes Fenster mit den meisten Sonnenminuten, auf die Sonne gekürzt', () => {
    assert.deepEqual(bestWindow(slots('----SSSSSSSSSSSSSSSS'), T0), {start: 4, end: 16, min: 60});
    assert.deepEqual(bestWindow(slots('--SS--------SSSSS---'), T0), {start: 12, end: 17, min: 25});
    // Lücke im Fenster: Rand bleibt an Sonnenschritten
    assert.deepEqual(bestWindow(slots('S-SS-----'), T0), {start: 0, end: 4, min: 15});
});

test('bestWindow: zählt nur ab from, null ohne Sonne', () => {
    const sl = slots('SSSS----SS--');
    assert.deepEqual(bestWindow(sl, new Date(+T0 + 10 * 60000)), {start: 2, end: 10, min: 20});
    assert.equal(bestWindow(sl, new Date(+T0 + 50 * 60000)), null);
    assert.equal(bestWindow(slots('--cc-nn'), T0), null);
});
