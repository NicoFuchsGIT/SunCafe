import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sunTrack, sunMinutes, isClosed} from '../js/sunminutes.js';
import {HORIZON_SECTORS} from '../js/config.js';

const DEG = Math.PI / 180;
const T0 = new Date(Date.UTC(2026, 5, 21, 10, 0));
// Sonne im Süden (Kompass 180°), Höhe als Funktion der Minuten ab T0; SunCalc-Azimut ist ab Süden, also 0
const pos = altOf => d => ({altitude: altOf((d - T0) / 60000) * DEG, azimuth: 0});
const flat = () => new Uint8Array(HORIZON_SECTORS);
const wallSouth = deg => { const m = flat(); m[90] = Math.round(deg * DEG / (Math.PI / 2 / 255)); return m; };
const cafe = (...masks) => ({pts: masks.map(mask => ({mask}))});
const hours = isOpen => ({getUnknown: () => false, getState: w => isOpen(w)});

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
    c.oh = hours(w => w - T0 >= 30 * 60000); // öffnet nach 30 min
    assert.equal(sunMinutes(c, sunTrack(T0, pos(() => 30))), 90);
});

test('unbekannte oder unlesbare Öffnungszeiten zählen als offen', () => {
    const w = new Date(T0);
    assert.equal(isClosed({}, w), false);
    assert.equal(isClosed({oh: {getUnknown: () => true, getState: () => false}}, w), false);
    assert.equal(isClosed({oh: {getUnknown: () => { throw new Error('x'); }, getState: () => false}}, w), false);
    assert.equal(isClosed({oh: hours(() => false)}, w), true);
});

test('Öffnungszeiten werden in Ortszeit geprüft', () => {
    const seen = [];
    const c = cafe(flat());
    c.oh = {getUnknown: () => false, getState: w => { seen.push(w.getHours()); return true; }};
    sunMinutes(c, sunTrack(T0, pos(() => 30), 'Europe/Vienna', 5, 5)); // 10:00 UTC = 12:00 Sommerzeit
    assert.deepEqual(seen, [12]);
});

test('ohne Masken: null', () => {
    assert.equal(sunMinutes({}, sunTrack(T0, pos(() => 30))), null);
    assert.equal(sunMinutes({pts: [{}]}, sunTrack(T0, pos(() => 30))), null);
});
