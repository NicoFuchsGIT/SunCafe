// Randfälle der Sonnenminuten (Roadmap 1.7, PRD F5.1) mit den echten Bibliotheken SunCalc und opening_hours
// (gleiche Versionen wie in index.html): Sonnenuntergang im Fenster, geschlossen, Mitternacht, Zeitzonen.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import SunCalc from 'suncalc';
import OpeningHours from 'opening_hours';
import {sunTrack, sunMinutes} from '../js/sunminutes.js';
import {parseHours} from '../js/hours.js';
import {HORIZON_SECTORS, MIN_ALT, SUN_STEP_MIN} from '../js/config.js';

globalThis.opening_hours = OpeningHours; // im Browser globale Variable aus index.html

const VIENNA = {lat: 48.2082, lng: 16.3738, tz: 'Europe/Vienna', rg: {country_code: 'at', state: 'Wien'}};
const MIN = 60000;
const utc = (...a) => new Date(Date.UTC(...a));
const flat = () => new Uint8Array(HORIZON_SECTORS);
const always = () => ({altitude: Math.PI / 4, azimuth: 0}); // Sonne immer 45° hoch im Süden
const real = p => d => SunCalc.getPosition(d, p.lat, p.lng);
// Café ohne Verdeckung an Ort p, optional mit Öffnungszeiten im OSM-Format
const cafe = (p, raw) => ({pts: [{mask: flat()}], oh: parseHours(raw, p.lat, p.lng, p.rg)});
const mins = (p, raw, start, getPos = real(p)) => sunMinutes(cafe(p, raw), sunTrack(start, getPos, p.tz));

// ---------- Sonnenuntergang im Fenster ----------
SunCalc.addTime(MIN_ALT * 180 / Math.PI, 'alt0rise', 'alt0set'); // Zeitpunkt, an dem die Sonne MIN_ALT kreuzt

test('Sonnenuntergang im Fenster: Schritte bis zum Untergang zählen', () => {
    const start = utc(2026, 5, 21, 18, 0); // 20:00 Sommerzeit, Untergang kurz vor 21:00
    const set = SunCalc.getTimes(start, VIENNA.lat, VIENNA.lng).alt0set;
    const expect = Math.ceil((set - start) / MIN / SUN_STEP_MIN) * SUN_STEP_MIN; // Schritte bei m = 0, 5, … vor dem Untergang
    assert.ok(expect > 30 && expect < 90, `Untergang ${set.toISOString()}`);
    assert.equal(mins(VIENNA, null, start), expect);
});

test('Sonnenuntergang: Fenster ganz danach 0, ganz davor volle 120 min', () => {
    assert.equal(mins(VIENNA, null, utc(2026, 5, 21, 19, 30)), 0);
    assert.equal(mins(VIENNA, null, utc(2026, 5, 21, 10, 0)), 120);
    assert.equal(mins(VIENNA, null, utc(2026, 11, 21, 15, 0)), 0); // Dezember: 16:00 ist es schon dunkel
});

test('Sonnenaufgang im Fenster: erst ab dem Aufgang', () => {
    const start = utc(2026, 5, 21, 2, 30); // 04:30, Aufgang kurz vor 05:00
    const rise = SunCalc.getTimes(start, VIENNA.lat, VIENNA.lng).alt0rise;
    const expect = 120 - Math.ceil((rise - start) / MIN / SUN_STEP_MIN) * SUN_STEP_MIN;
    assert.ok(expect > 60 && expect < 120, `Aufgang ${rise.toISOString()}`);
    assert.equal(mins(VIENNA, null, start), expect);
});

test('Sonnenuntergang und Schließzeit: es zählt nur, was offen und sonnig ist', () => {
    const start = utc(2026, 5, 21, 17, 0); // 19:00 bis 21:00, Untergang gegen 21:00
    const set = SunCalc.getTimes(start, VIENNA.lat, VIENNA.lng).alt0set;
    assert.ok((set - start) / MIN > 90);
    assert.equal(mins(VIENNA, 'Mo-Su 08:00-19:30', start), 30);
    assert.equal(mins(VIENNA, 'Mo-Su 19:30-23:00', start), Math.ceil((set - start) / MIN / SUN_STEP_MIN) * SUN_STEP_MIN - 30);
});

// ---------- geschlossen ----------
test('geschlossen: Ruhetag, off und Feiertag zählen nicht', () => {
    const sun = utc(2026, 5, 21, 10, 0); // Sonntag, 12:00
    assert.equal(mins(VIENNA, 'Mo-Sa 08:00-18:00', sun, always), 0);
    assert.equal(mins(VIENNA, 'Mo-Su 08:00-18:00; Su off', sun, always), 0);
    assert.equal(mins(VIENNA, 'off', sun, always), 0);
    assert.equal(mins(VIENNA, 'Mo-Su 08:00-18:00', sun, always), 120);
    const holiday = utc(2026, 9, 26, 10, 0); // Montag, 26. Oktober: Nationalfeiertag
    assert.equal(mins(VIENNA, 'Mo-Fr 08:00-18:00; PH off', holiday, always), 0);
    assert.equal(mins(VIENNA, 'Mo-Fr 08:00-18:00; PH off', utc(2026, 9, 27, 10, 0), always), 120);
});

test('geschlossen: öffnet oder schließt mitten im Fenster', () => {
    const start = utc(2026, 5, 22, 6, 0); // Montag, 08:00
    assert.equal(mins(VIENNA, 'Mo-Fr 09:00-18:00', start, always), 60);
    assert.equal(mins(VIENNA, 'Mo-Fr 07:00-08:45', start, always), 45);
    assert.equal(mins(VIENNA, 'Mo-Fr 08:00-08:30,09:00-09:30', start, always), 60); // zwei Zeiträume
});

test('unklare Öffnungszeiten zählen als offen', () => {
    const start = utc(2026, 5, 22, 6, 0);
    assert.equal(mins(VIENNA, 'Mo-Fr 08:00-10:00 "nach Vereinbarung"', start, always), 120);
    assert.equal(mins(VIENNA, 'Mo-Fr 09:00-10:00 unknown', start, always), 60); // davor sicher geschlossen
    assert.equal(mins(VIENNA, 'kaputt ##', start, always), 120); // unlesbar: parseHours liefert null
});

// ---------- Mitternacht ----------
test('Mitternacht: Öffnungszeiten über Mitternacht', () => {
    const late = utc(2026, 5, 22, 21, 0); // Montag 23:00 bis Dienstag 01:00
    assert.equal(mins(VIENNA, 'Mo-Su 18:00-02:00', late, always), 120);
    assert.equal(mins(VIENNA, 'Mo-Su 18:00-24:00', late, always), 60);
    assert.equal(mins(VIENNA, 'Mo 10:00-24:00; Tu 00:00-00:30', late, always), 90);
    assert.equal(mins(VIENNA, 'Mo-Su 18:00-02:00', utc(2026, 5, 22, 23, 0), always), 60); // 01:00 bis 03:00
});

test('Mitternacht: die Nacht gehört zum Vortag', () => {
    // Fr-Sa 18:00-02:00 heißt: Samstag und Sonntag früh offen, Freitag früh nicht
    assert.equal(mins(VIENNA, 'Fr-Sa 18:00-02:00', utc(2026, 5, 18, 23, 0), always), 0);  // Fr 01:00
    assert.equal(mins(VIENNA, 'Fr-Sa 18:00-02:00', utc(2026, 5, 19, 23, 0), always), 60); // Sa 01:00
    assert.equal(mins(VIENNA, 'Fr-Sa 18:00-02:00', utc(2026, 5, 20, 23, 0), always), 60); // So 01:00
    assert.equal(mins(VIENNA, 'Fr-Sa 18:00-02:00', utc(2026, 5, 21, 23, 0), always), 0);  // Mo 01:00
});

test('Mitternacht: Mitternachtssonne in Tromsø', () => {
    const tromso = {lat: 69.6492, lng: 18.9553, tz: 'Europe/Oslo', rg: {country_code: 'no'}};
    const start = utc(2026, 5, 21, 21, 0); // 23:00 bis 01:00 Sommerzeit
    assert.equal(mins(tromso, null, start), 120);
    assert.equal(mins(tromso, 'Mo-Su 10:00-24:00', start), 60);
    assert.equal(mins(tromso, null, utc(2026, 11, 21, 21, 0)), 0); // Polarnacht
});

// ---------- Zeitzonen ----------
test('Zeitzonen: Öffnungszeiten gelten in der Ortszeit des Cafés', () => {
    // derselbe Zeitpunkt (10:00 UTC), dieselben Öffnungszeiten, drei Zeitzonen
    const start = utc(2026, 5, 22, 10, 0), raw = 'Mo-Su 07:00-12:00';
    assert.equal(mins(VIENNA, raw, start, always), 0);                               // 12:00 bis 14:00
    assert.equal(mins({...VIENNA, tz: 'Europe/London'}, raw, start, always), 60);    // 11:00 bis 13:00
    assert.equal(mins({...VIENNA, tz: 'America/New_York'}, raw, start, always), 60); // 06:00 bis 08:00
});

test('Zeitzonen: Ende der Sommerzeit, die Stunde 02:00 bis 03:00 kommt zweimal', () => {
    // 25. Oktober 2026: 03:00 Sommerzeit wird 02:00 Winterzeit (01:00 UTC). Fenster 00:00 bis 02:00 UTC
    // läuft in Ortszeit 02:00–03:00 zweimal; offen ab 02:30 trifft beide Durchgänge.
    const start = utc(2026, 9, 25, 0, 0);
    assert.equal(mins(VIENNA, null, start, always), 120);
    assert.equal(mins(VIENNA, 'Mo-Su 02:30-04:00', start, always), 60);
});

test('Zeitzonen: Beginn der Sommerzeit, die Stunde 02:00 bis 03:00 fehlt', () => {
    // 29. März 2026: 02:00 Winterzeit wird 03:00 Sommerzeit (01:00 UTC). Fenster 00:00 bis 02:00 UTC = 01:00 bis 05:00 Ortszeit
    const start = utc(2026, 2, 29, 0, 0);
    assert.equal(mins(VIENNA, null, start, always), 120);
    assert.equal(mins(VIENNA, 'Mo-Su 03:00-04:00', start, always), 60);
    assert.equal(mins(VIENNA, 'Mo-Su 01:00-03:00', start, always), 60);
});

// Die Rechnung darf nicht von der Zeitzone des Geräts abhängen: dieselbe Datei in anderen Zeitzonen ausführen
test('Zeitzonen: Ergebnis unabhängig von der Zeitzone des Geräts', {skip: !!process.env.SUNCAFE_TZ_CHILD}, () => {
    const file = fileURLToPath(import.meta.url);
    for (const TZ of ['UTC', 'Europe/Vienna', 'America/New_York', 'Pacific/Auckland', 'Asia/Kolkata']) {
        try {
            execFileSync(process.execPath, ['--test', '--test-reporter=dot', file], {env: {...process.env, TZ, SUNCAFE_TZ_CHILD: '1'}, stdio: 'pipe'});
        } catch(e) {
            assert.fail(`TZ=${TZ}:\n${e.stdout}${e.stderr}`);
        }
    }
});
