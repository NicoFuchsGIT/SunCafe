// Smoke-Test für js/ui.js im echten Browser (Popup, Vote, Fehlerpfad, Nacht). Läuft nicht in `npm test`, sondern mit `npm run test:e2e`.
// Braucht Playwright samt Chromium (PLAYWRIGHT_MODULE = Pfad zum Modul, falls nicht lokal installiert; CHROMIUM_PATH optional).
// Die Karte ist durch eine Attrappe ersetzt (kein WebGL, kein Tile-Server nötig); getestet wird die Oberfläche mit den echten Wien-Daten.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync, existsSync, statSync} from 'node:fs';
import {extname, join, resolve} from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
let pw = null;
try { pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'); } catch (e) { /* ohne Playwright überspringen */ }
const skip = pw ? false : 'Playwright nicht installiert';
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml'};

// Minimale Ersatz-Karte: feuert „load“, merkt sich Quellen, Popup hängt seinen Inhalt in die Seite
const MAP_STUB = () => {
    const noop = () => {};
    class Ev { constructor() { this.h = {}; } on(e, ...a) { (this.h[e] ||= []).push(a.at(-1)); return this; } once(e, f) { return this.on(e, f); } fire(e) { (this.h[e] || []).forEach(f => f()); } }
    class Map extends Ev {
        constructor() { super(); this.src = {}; setTimeout(() => this.fire('load'), 0); }
        on(e, ...a) { if (e === 'load' || e === 'idle') { setTimeout(a.at(-1), 0); return this; } return super.on(e, ...a); }
        addControl() {} addLayer() {} addSource(id) { this.src[id] = {setData: noop}; } getSource(id) { return this.src[id]; }
        getCanvas() { return {style: {}}; } getZoom() { return 16; } getCenter() { return {lat: 48.2082, lng: 16.3738}; }
        flyTo() {} jumpTo() {} resize() {} loaded() { return true; } getStyle() { return {sources: {}}; } querySourceFeatures() { return []; }
    }
    class Popup extends Ev {
        setLngLat() { return this; }
        setDOMContent(el) { this._w = document.createElement('div'); this._w.id = 'test-popup'; this._w.appendChild(el); return this; }
        addTo() { document.body.appendChild(this._w); return this; }
        remove() { this._w.remove(); this.fire('close'); }
    }
    class Ctl { constructor() { this.h = {}; } on() { return this; } }
    window.maplibregl = {Map, Popup, NavigationControl: Ctl, GeolocateControl: Ctl, AttributionControl: Ctl};
    // Standort fällt aus: die App nimmt dann Wien
    Object.defineProperty(navigator, 'geolocation', {value: {getCurrentPosition: (ok, fail) => fail(new Error('aus'))}});
};

let server, browser, base;
before(async () => {
    if (!pw) return;
    server = http.createServer((q, r) => {
        let p = q.url.split('?')[0]; if (p === '/') p = '/index.html';
        const f = join(ROOT, p);
        if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); }
        r.setHeader('content-type', TYPES[extname(f)] || 'application/octet-stream'); r.end(readFileSync(f));
    }).listen(0);
    base = 'http://localhost:' + server.address().port;
    browser = await pw.chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
});
after(async () => { await browser?.close(); server?.close(); });

// Seite öffnen zu einer festen Uhrzeit (UTC); vote: Antwort der Vote-API
async function open(time, vote) {
    const ctx = await browser.newContext({locale: 'de-AT', timezoneId: 'Europe/Vienna'});
    const page = await ctx.newPage();
    await page.clock.install({time: new Date(time)});
    await page.route('**/vendor/maplibre-gl.js', r => r.fulfill({contentType: 'text/javascript', body: `(${MAP_STUB})()`}));
    await page.route('**/api.open-meteo.com/**', r => r.abort());
    await page.route('**/nominatim.openstreetmap.org/**', r => r.abort());
    const sent = [];
    await page.route('**/api/vote', async r => { sent.push(r.request().postDataJSON()); await new Promise(f => setTimeout(f, 150)); await r.fulfill(vote()); });
    await page.goto(base);
    await page.waitForSelector('#list li');
    return {page, sent, ctx};
}
const openFirst = async page => { await page.locator('#list li').first().click(); await page.waitForSelector('#test-popup'); };

test('Mittags: Popup zeigt drei Vote-Knöpfe mit Icons', {skip}, async () => {
    const {page, ctx} = await open('2026-07-01T10:00:00Z', () => ({status: 204}));
    await openFirst(page);
    assert.equal(await page.locator('#test-popup .vote-btn').count(), 3);
    assert.equal(await page.locator('#test-popup .vote-btn svg.icon').count(), 3);
    assert.equal(await page.locator('#test-popup .vote-btn.v-sun').innerText().then(x => x.trim()), 'Sonne');
    await ctx.close();
});

test('Fehlerpfad: Meldung bleibt sichtbar, Knöpfe wieder aktiv, zweiter Versuch klappt, genau ein Request je Klick', {skip}, async () => {
    let answers = [{status: 500, body: '{}'}, {status: 204}];
    const {page, sent, ctx} = await open('2026-07-01T10:00:00Z', () => answers.shift());
    await openFirst(page);
    const btn = page.locator('#test-popup .vote-btn.v-shade');
    await btn.dblclick(); // Doppelklick darf nur einen Request auslösen
    await page.waitForSelector('#test-popup .vote-note:has-text("Senden fehlgeschlagen")');
    assert.equal(sent.length, 1);
    assert.equal(await page.locator('#test-popup .vote-btn:not([disabled])').count(), 3);
    const first = sent[0];
    assert.match(first.placeId, /^(node|way|relation)\/\d+$/);
    assert.ok(Math.abs(Date.parse(first.t) - Date.parse('2026-07-01T10:00:00Z')) < 60000, 'Zeitstempel ist „jetzt“');
    await page.locator('#test-popup .vote-btn.v-sun').click();
    await page.waitForSelector('#test-popup .vote-note:has-text("Danke")');
    assert.equal(sent.length, 2);
    assert.equal(await page.locator('#test-popup .vote-btn').count(), 0);
    await ctx.close();
});

test('Nachts: keine Vote-Knöpfe', {skip}, async () => {
    const {page, ctx} = await open('2026-07-01T22:30:00Z', () => ({status: 204}));
    await openFirst(page);
    assert.equal(await page.locator('#test-popup .vote-btn').count(), 0);
    assert.equal(await page.locator('#test-popup .vote').isVisible(), false);
    await ctx.close();
});

test('Zeitschieber verstellt: Hinweis „nur für Jetzt“ statt Knöpfen', {skip}, async () => {
    const {page, ctx} = await open('2026-07-01T10:00:00Z', () => ({status: 204}));
    await openFirst(page);
    await page.locator('#slider').evaluate(el => { el.value = '4'; el.dispatchEvent(new Event('input')); });
    await page.waitForSelector('#test-popup .vote-note:has-text("nur für")');
    assert.equal(await page.locator('#test-popup .vote-btn').count(), 0);
    await ctx.close();
});
