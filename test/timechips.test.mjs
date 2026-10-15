import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chipSlot, CHIPS} from '../js/timechips.js';

const at = s => new Date(s);
// 10:10 UTC, Schieber-Start auf 10:00 abgerundet, 30-min-Schritte, 48 h
const base = {now: at('2026-07-01T10:10:00Z'), t0: at('2026-07-01T10:00:00Z'), step: 30, max: 96,
    sunset: at('2026-07-01T19:00:00Z'), sunriseNext: at('2026-07-02T03:30:00Z')};

test('Chips: Jetzt ist immer 0', () => assert.equal(chipSlot('now', base), 0));
test('Chips: +1 h liegt zwei bis drei Schritte voraus', () => assert.equal(chipSlot('plus1', base), 2));
test('Chips: Abend = eine Stunde vor Sonnenuntergang (18:00 → 16 Schritte)', () => assert.equal(chipSlot('evening', base), 16));
test('Chips: Morgen früh = Sonnenaufgang + 2 h (05:30 am Folgetag)', () => assert.equal(chipSlot('morning', base), 39));
test('Chips: Abend entfällt, wenn er vorbei ist', () => {
    assert.equal(chipSlot('evening', {...base, now: at('2026-07-01T18:30:00Z'), t0: at('2026-07-01T18:30:00Z')}), null);
});
test('Chips: ungültige Sonnenzeiten (Polarzeit) ergeben null', () => {
    assert.equal(chipSlot('evening', {...base, sunset: new Date(NaN)}), null);
    assert.equal(chipSlot('morning', {...base, sunriseNext: undefined}), null);
});
test('Chips: außerhalb des Schieberbereichs ergibt null', () => {
    assert.equal(chipSlot('morning', {...base, max: 10}), null);
});
test('Chips: unbekannte Art ergibt null, Liste ist vollständig', () => {
    assert.equal(chipSlot('xyz', base), null);
    assert.deepEqual(CHIPS, ['now', 'plus1', 'evening', 'morning']);
});
