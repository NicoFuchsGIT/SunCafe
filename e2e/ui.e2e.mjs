// Smoke-Test für js/ui.js im echten Browser (Sheet, Vote, Fehlerpfad, Nacht, Mobil-Layout, Standortfluss). Läuft nicht in `npm test`, sondern mit `npm run test:e2e`.
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

// Minimale Ersatz-Karte: feuert „load“ und merkt sich Quellen (das Café-Sheet ist normales DOM, kein Karten-Popup)
const MAP_STUB = () => {
    const noop = () => {};
    class Ev { constructor() { this.h = {}; } on(e, ...a) { (this.h[e] ||= []).push(a.at(-1)); return this; } once(e, f) { return this.on(e, f); } fire(e) { (this.h[e] || []).forEach(f => f()); } }
    class Map extends Ev {
        constructor() { super(); this.src = {}; setTimeout(() => this.fire('load'), 0); }
        on(e, ...a) { if (e === 'load' || e === 'idle') { setTimeout(a.at(-1), 0); return this; } return super.on(e, ...a); }
        addControl() {} addLayer() {} addSource(id) { this.src[id] = {setData: noop}; } getSource(id) { return this.src[id]; }
        getCanvas() { return {style: {}}; } getZoom() { return 16; } getCenter() { return {lat: 48.2082, lng: 16.3738}; }
        flyTo() {} jumpTo() {} easeTo() {} addImage() {} resize() {} queryRenderedFeatures() { return []; } loaded() { return true; } getStyle() { return {sources: {}}; } querySourceFeatures() { return []; }
    }
    class Popup extends Ev {
        setLngLat() { return this; }
        setDOMContent(el) { this._w = document.createElement('div'); this._w.id = 'sheet'; this._w.appendChild(el); return this; }
        addTo() { document.body.appendChild(this._w); return this; }
        remove() { this._w.remove(); this.fire('close'); }
    }
    class Ctl { constructor() { this.h = {}; } on() { return this; } }
    window.maplibregl = {Map, Popup, NavigationControl: Ctl, GeolocateControl: Ctl, AttributionControl: Ctl};
    // Standort: liefert Wien oder schlägt fehl (code 1 = abgelehnt), je nach window.__geo
    Object.defineProperty(navigator, 'geolocation', {value: {getCurrentPosition: (ok, fail) => window.__geo === 'denied'
        ? fail({code: 1}) : ok({coords: {latitude: 48.2082, longitude: 16.3738}})}});
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
async function open(time, vote, {mobile = false, geo = 'ok', size = [390, 844], safe = null, ua = null} = {}) {
    // Standard iPhone 14: 390 × 844, Touch; safe = {top, bottom} ersetzt env(safe-area-inset-*) (Chromium kennt keine Notch)
    const ctx = await browser.newContext({locale: 'de-AT', timezoneId: 'Europe/Vienna', ...(ua ? {userAgent: ua} : {}),
        ...(mobile ? {viewport: {width: size[0], height: size[1]}, hasTouch: true, isMobile: true, deviceScaleFactor: 3} : {})});
    const page = await ctx.newPage();
    await page.addInitScript(g => { window.__geo = g; }, geo);
    await page.clock.install({time: new Date(time)});
    await page.route('**/vendor/maplibre-gl.js', r => r.fulfill({contentType: 'text/javascript', body: `(${MAP_STUB})()`}));
    if (safe) await page.route('**/css/style.css', async r => {
        const resp = await r.fetch();
        r.fulfill({response: resp, body: (await resp.text()).replaceAll('env(safe-area-inset-top)', safe.top + 'px').replaceAll('env(safe-area-inset-bottom)', safe.bottom + 'px')});
    });
    await page.route('**/api.open-meteo.com/**', r => r.abort());
    await page.route('**/nominatim.openstreetmap.org/**', r => r.abort());
    const sent = [];
    await page.route('**/api/vote', async r => { sent.push(r.request().postDataJSON()); await new Promise(f => setTimeout(f, 150)); await r.fulfill(vote()); });
    await page.goto(base);
    if (geo === 'ok') await page.waitForSelector('#list li', {state: 'attached'});
    return {page, sent, ctx};
}
const openFirst = async page => {
    if (await page.locator('#toggle-sidebar').isVisible()) await page.locator('#toggle-sidebar').click(); // mobil: erst die Liste öffnen
    await page.locator('#list li').first().click(); await page.waitForSelector('#sheet:not([hidden])');
};

test('Mittags: Popup zeigt drei Vote-Knöpfe mit Icons', {skip}, async () => {
    const {page, ctx} = await open('2026-07-01T10:00:00Z', () => ({status: 204}));
    await openFirst(page);
    assert.equal(await page.locator('#sheet .vote-btn').count(), 3);
    assert.equal(await page.locator('#sheet .vote-btn svg.icon').count(), 3);
    assert.equal(await page.locator('#sheet .vote-btn.v-sun').innerText().then(x => x.trim()), 'Sonne');
    await ctx.close();
});

test('Fehlerpfad: Meldung bleibt sichtbar, Knöpfe wieder aktiv, zweiter Versuch klappt, genau ein Request je Klick', {skip}, async () => {
    let answers = [{status: 500, body: '{}'}, {status: 204}];
    const {page, sent, ctx} = await open('2026-07-01T10:00:00Z', () => answers.shift());
    await openFirst(page);
    const btn = page.locator('#sheet .vote-btn.v-shade');
    await btn.dblclick(); // Doppelklick darf nur einen Request auslösen
    await page.waitForSelector('#sheet .vote-note:has-text("Senden fehlgeschlagen")');
    assert.equal(sent.length, 1);
    assert.equal(await page.locator('#sheet .vote-btn:not([disabled])').count(), 3);
    const first = sent[0];
    assert.match(first.placeId, /^(node|way|relation)\/\d+$/);
    assert.ok(Math.abs(Date.parse(first.t) - Date.parse('2026-07-01T10:00:00Z')) < 60000, 'Zeitstempel ist „jetzt“');
    await page.locator('#sheet .vote-btn.v-sun').click();
    await page.waitForSelector('#sheet .vote-note:has-text("Danke")');
    assert.equal(sent.length, 2);
    assert.equal(await page.locator('#sheet .vote-btn').count(), 0);
    await ctx.close();
});

test('Nachts: keine Vote-Knöpfe', {skip}, async () => {
    const {page, ctx} = await open('2026-07-01T22:30:00Z', () => ({status: 204}));
    await openFirst(page);
    assert.equal(await page.locator('#sheet .vote-btn').count(), 0);
    assert.equal(await page.locator('#sheet .vote').isVisible(), false);
    await ctx.close();
});

test('Zeitschieber verstellt: Hinweis „nur für Jetzt“ statt Knöpfen', {skip}, async () => {
    const {page, ctx} = await open('2026-07-01T10:00:00Z', () => ({status: 204}));
    await openFirst(page);
    await page.locator('#slider').evaluate(el => { el.value = '4'; el.dispatchEvent(new Event('input')); });
    await page.waitForSelector('#sheet .vote-note:has-text("nur für")');
    assert.equal(await page.locator('#sheet .vote-btn').count(), 0);
    await ctx.close();
});

test('Mobil (iPhone 14): Karte im Vollbild, Dock unten, Liste erst nach Tippen sichtbar', {skip}, async () => {
    const {page, ctx} = await open('2026-07-01T10:00:00Z', () => ({status: 204}), {mobile: true});
    const box = async sel => page.locator(sel).boundingBox();
    const map = await box('#map'), dock = await box('#dock'), top = await box('#topbar');
    assert.deepEqual([map.x, map.y, map.width, map.height], [0, 0, 390, 844]);
    assert.ok(dock.y + dock.height >= 843 && dock.width === 390, 'Dock sitzt unten über die volle Breite');
    assert.ok(top.y < 20 && top.y + top.height < dock.y);
    assert.equal(await page.locator('#side').isVisible(), false);
    await page.locator('#toggle-sidebar').click();
    await page.waitForSelector('#side', {state: 'visible'}); // blendet in 150 ms ein
    assert.equal(await page.locator('#toggle-sidebar').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#toggle-sidebar').innerText().then(x => x.trim()), 'Karte');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#side', {state: 'hidden'});
    // Tap-Ziele mindestens 44 px
    for (const sel of ['#toggle-sidebar', '#filter-btn', '#locate-btn', '#info-btn', '#chips .chip:not([hidden])']) {
        const b = await page.locator(sel).first().boundingBox();
        assert.ok(b.width >= 44 && b.height >= 44, sel + ' ist zu klein: ' + JSON.stringify(b));
    }
    await ctx.close();
});

test('Listeneintrag öffnet das Sheet auf der Karte, Route-Link hat Koordinaten und läuft zu Fuß', {skip}, async () => {
    const {page, ctx} = await open('2026-07-01T10:00:00Z', () => ({status: 204}), {mobile: true});
    await openFirst(page);
    await page.waitForSelector('#side', {state: 'hidden'}); // zurück auf der Karte
    const href = await page.locator('#sheet .btn-route').getAttribute('href');
    const u = new URL(href);
    assert.match(u.searchParams.get('destination'), /^48\.\d+,16\.\d+$/);
    assert.equal(u.searchParams.get('travelmode'), 'walking');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#sheet').isHidden(), true);
    await ctx.close();
});

test('Chips: Jetzt ist aktiv, +1 h setzt den Schieber, „Vorschau“ erscheint', {skip}, async () => {
    const {page, ctx} = await open('2026-07-01T10:00:00Z', () => ({status: 204}), {mobile: true});
    assert.equal(await page.locator('[data-chip=now]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#preview').isHidden(), true);
    await page.locator('[data-chip=plus1]').click();
    assert.equal(await page.locator('#slider').inputValue(), '2');
    assert.equal(await page.locator('[data-chip=plus1]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#preview').isVisible(), true);
    await page.locator('[data-chip=now]').click();
    assert.equal(await page.locator('#slider').inputValue(), '0');
    await ctx.close();
});

test('Abend-Chip fehlt nach Sonnenuntergang, Morgen-Chip bleibt', {skip}, async () => {
    const {page, ctx} = await open('2026-07-01T22:30:00Z', () => ({status: 204}), {mobile: true});
    assert.equal(await page.locator('[data-chip=evening]').isHidden(), true);
    assert.equal(await page.locator('[data-chip=morning]').isVisible(), true);
    await ctx.close();
});

test('Filter-Panel: Anzahl aktiver Filter am Knopf, Kategorie per Chip', {skip}, async () => {
    const {page, ctx} = await open('2026-07-01T10:00:00Z', () => ({status: 204}), {mobile: true});
    assert.equal(await page.locator('#filter-badge').isHidden(), true);
    await page.locator('#filter-btn').click();
    assert.equal(await page.locator('#filters-panel').isVisible(), true);
    await page.locator('#fopen').check();
    await page.locator('[data-ptype=bar]').click();
    assert.equal(await page.locator('#filter-badge').innerText(), '2');
    assert.equal(await page.locator('#ptype').inputValue(), 'bar');
    assert.equal(await page.locator('[data-ptype=bar]').getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#filters-panel').isHidden(), true);
    await ctx.close();
});

test('Standort abgelehnt: Dialog „Wo bist du?“ statt stillem Wien, nichts wird geladen', {skip}, async () => {
    const {page, ctx} = await open('2026-07-01T10:00:00Z', () => ({status: 204}), {mobile: true, geo: 'denied'});
    await page.waitForSelector('#where[open]');
    assert.match(await page.locator('#where-msg').innerText(), /nicht freigegeben/);
    assert.equal(await page.locator('#list li').count(), 0);
    await page.locator('#where-center').click(); // bewusste Wahl: Wien Zentrum
    await page.waitForSelector('#list li', {state: 'attached'});
    assert.equal(await page.locator('#where[open]').count(), 0);
    await ctx.close();
});

test('Manuell platzieren: Pin-Knopf in der Topbar, Abbrechen und Bestätigen', {skip}, async () => {
    const {page, ctx} = await open('2026-07-01T10:00:00Z', () => ({status: 204}), {mobile: true});
    await page.locator('#pick-btn').click();
    assert.equal(await page.locator('#center-marker').isVisible(), true);
    assert.equal(await page.locator('#pick-bar').isVisible(), true);
    assert.equal(await page.locator('#dock').isHidden(), true);
    await page.locator('#pick-cancel').click();
    assert.equal(await page.locator('#center-marker').isHidden(), true);
    assert.equal(await page.locator('#dock').isVisible(), true);
    await page.locator('#pick-btn').click();
    await page.keyboard.press('Escape'); // Esc bricht ebenfalls ab
    assert.equal(await page.locator('#pick-bar').isHidden(), true);
    await page.locator('#pick-btn').click();
    await page.locator('#confirm-place-btn').click();
    assert.equal(await page.locator('#pick-bar').isHidden(), true);
    await page.waitForSelector('#list li', {state: 'attached'});
    await ctx.close();
});

test('iPhone 17 (402 × 874, Dynamic Island): Info-Dialog mit „×“ liegt innerhalb der Safe-Area und schließt', {skip}, async () => {
    const safe = {top: 59, bottom: 34};
    const {page, ctx} = await open('2026-07-01T10:00:00Z', () => ({status: 204}), {mobile: true, size: [402, 874], safe});
    await page.locator('#info-btn').click();
    const r = await page.locator('#info').boundingBox(), x = await page.locator('#info .info-x').boundingBox();
    assert.ok(r.y >= safe.top, 'Dialog beginnt unter der Statusleiste: ' + r.y);
    assert.ok(r.y + r.height <= 874 - safe.bottom, 'Dialog endet über dem Home-Indikator');
    assert.ok(x.y >= safe.top && x.x + x.width <= 402 && x.x >= 0, '× sichtbar: ' + JSON.stringify(x));
    await page.locator('#info .info-x').click();
    assert.equal(await page.locator('#info[open]').count(), 0);
    // „Wo bist du?“ folgt derselben Regel
    await ctx.close();
});

test('iPhone: Google Maps ist die Hauptwahl, Apple Karten der zweite Link, die letzte Wahl wird gemerkt', {skip}, async () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const {page, ctx} = await open('2026-07-01T10:00:00Z', () => ({status: 204}), {mobile: true, ua});
    await openFirst(page);
    assert.match(await page.locator('#sheet .btn-route').getAttribute('href'), /google\.com\/maps\/dir/);
    assert.match(await page.locator('#sheet .route-alt').getAttribute('href'), /maps\.apple\.com/);
    await page.evaluate(() => { document.querySelector('#sheet .route-alt').target = '_self'; document.querySelector('#sheet .route-alt').removeAttribute('href'); document.querySelector('#sheet .route-alt').click(); });
    await page.keyboard.press('Escape'); await page.locator('#toggle-sidebar').click(); await page.locator('#list li').first().click();
    await page.waitForSelector('#sheet:not([hidden])');
    assert.match(await page.locator('#sheet .btn-route').getAttribute('href'), /maps\.apple\.com/, 'Apple Karten ist jetzt die Hauptwahl');
    await ctx.close();
});

test('Android und Desktop: nur ein Routenlink (Google Maps)', {skip}, async () => {
    const {page, ctx} = await open('2026-07-01T10:00:00Z', () => ({status: 204}));
    await openFirst(page);
    assert.equal(await page.locator('#sheet .route-alt').count(), 0);
    await ctx.close();
});
