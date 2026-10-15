// Testlücken aus dem Code-Review: wall und openInfo (offen, geschlossen, unklar, unbekannt, Zeitzone)
import {test} from 'node:test';
import assert from 'node:assert/strict';
import OpeningHours from 'opening_hours';
globalThis.opening_hours = OpeningHours;
const {wall, openInfo, parseHours} = await import('../js/hours.js');
const {setLang} = await import('../js/i18n.js');
setLang('de');

const cafe = raw => ({raw, oh: parseHours(raw, 48.2, 16.37, {country_code: 'at', state: 'Wien'})});
const at = (y, m, d, h, mi = 0) => new Date(y, m - 1, d, h, mi); // lokale Zeit, wie wall() sie liefert

test('wall: ohne Zeitzone unverändert, mit Zeitzone die Ortszeit', () => {
    const d = new Date('2026-07-01T12:00:00Z');
    assert.equal(wall(d, null), d);
    assert.equal(wall(d, 'Europe/Vienna').getHours(), 14);  // Sommerzeit UTC+2
    assert.equal(wall(d, 'Asia/Tokyo').getHours(), 21);
    assert.equal(wall(new Date('2026-01-01T12:00:00Z'), 'Europe/Vienna').getHours(), 13); // Winterzeit UTC+1
    assert.equal(wall(new Date('2026-12-31T23:30:00Z'), 'Asia/Tokyo').getDate(), 1);      // Datumswechsel
});

test('openInfo: ohne Angabe unbekannt', () => {
    assert.equal(openInfo({oh: null}, at(2026, 7, 1, 12)).o, -1);
});

test('openInfo: offen mit Schließzeit, geschlossen mit Öffnungszeit', () => {
    const c = cafe('Mo-Su 08:00-20:00');
    const open = openInfo(c, at(2026, 7, 1, 12));
    assert.equal(open.o, 1); assert.match(open.text, /Geöffnet, schließt/); assert.match(open.text, /20:00/);
    const closed = openInfo(c, at(2026, 7, 1, 22));
    assert.equal(closed.o, 0); assert.match(closed.text, /Geschlossen, öffnet/);
});

test('openInfo: Mitternacht und mehrtägige Öffnung', () => {
    const c = cafe('Mo-Su 18:00-02:00');
    assert.equal(openInfo(c, at(2026, 7, 2, 1)).o, 1);   // nach Mitternacht noch offen
    assert.equal(openInfo(c, at(2026, 7, 2, 10)).o, 0);
});

test('openInfo: unklare Angabe liefert o=-1 und den Rohtext', () => {
    const r = openInfo(cafe('Mo-Fr 10:00-18:00 "nach Vereinbarung"'), at(2026, 7, 1, 12));
    assert.equal(r.o, -1);
    assert.match(r.text, /unklar/);
});

test('openInfo: Ausnahmen werden abgefangen', () => {
    const r = openInfo({oh: {getNextChange() { throw new Error('x'); }}}, at(2026, 7, 1, 12));
    assert.equal(r.o, -1);
});

test('parseHours: ungültig oder leer ergibt null', () => {
    assert.equal(parseHours('###', 48.2, 16.37, null), null);
    assert.equal(parseHours('', 48.2, 16.37, null), null);
});
