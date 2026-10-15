// Testlücken aus dem Code-Review: parseCafes, fetchCafes (Wien-Turbo, Fallback), geocode, fetchWeather
import {test} from 'node:test';
import assert from 'node:assert/strict';
import OpeningHours from 'opening_hours';
globalThis.opening_hours = OpeningHours;
const {parseCafes, fetchCafes, geocode, fetchWeather, inWien} = await import('../js/data.js');

const node = (id, tags, lat = 48.2082, lon = 16.3738) => ({type: 'node', id, lat, lon, tags});

test('parseCafes: Kategorien, Kettenfilter und Felder', () => {
    const data = {elements: [
        node(1, {amenity: 'cafe', name: 'Café Central', opening_hours: 'Mo-Su 08:00-20:00', 'addr:street': 'Herrengasse', 'addr:housenumber': '14', outdoor_seating: 'yes'}),
        node(2, {shop: 'bakery', name: 'Bäckerei'}),
        node(3, {amenity: 'bar', name: 'Bar'}),
        node(4, {amenity: 'restaurant', name: 'Lokal'}),
        node(5, {amenity: 'cafe', name: 'Ströck Filiale'}),
        node(6, {amenity: 'cafe', name: 'Schmankerl Café'}), // „anker“ nur als ganzes Wort
        {type: 'node', id: 7}, // ohne Tags
        {type: 'way', id: 8, center: {lat: 48.209, lon: 16.374}, tags: {amenity: 'cafe', name: 'Way-Café'}}
    ]};
    const ids = p => parseCafes(data, 48.2082, 16.3738, {country_code: 'at', state: 'Wien'}, p).map(c => c.id);
    assert.deepEqual(ids('cafe'), ['1', '2', '6', '8']);
    assert.deepEqual(ids('bar'), ['1', '2', '3', '6', '8']);
    assert.deepEqual(ids('rest'), ['1', '2', '3', '4', '6', '8']);
    const [c, , , w] = parseCafes(data, 48.2082, 16.3738, {country_code: 'at', state: 'Wien'});
    assert.equal(c.osmId, 'node/1'); assert.equal(w.osmId, 'way/8');
    assert.equal(c.addr, 'Herrengasse 14'); assert.equal(c.outdoor, 'yes'); assert.equal(c.calc, false);
    assert.ok(c.oh, 'Öffnungszeiten geparst'); assert.equal(c.dist, 0); assert.ok(w.dist > 0);
});

test('parseCafes: Terrasse gehört zum nächsten Café innerhalb des Abstands', () => {
    const data = {elements: [
        node(1, {amenity: 'cafe', name: 'A'}, 48.2082, 16.3738),
        node(2, {amenity: 'cafe', name: 'B'}, 48.2090, 16.3738),
        node(3, {leisure: 'outdoor_seating'}, 48.20824, 16.3738), // ~4 m neben A
        node(4, {amenity: 'biergarten'}, 48.2150, 16.3738)         // zu weit weg
    ]};
    const [a, b] = parseCafes(data, 48.2082, 16.3738, null);
    assert.equal(a.terr.length, 1); assert.equal(b.terr.length, 0);
});

test('parseCafes: Element ohne Koordinaten wird übersprungen, kaputte Öffnungszeiten stören nicht', () => {
    const data = {elements: [{type: 'way', id: 1, tags: {amenity: 'cafe'}}, node(2, {amenity: 'cafe', opening_hours: 'kein gültiger Wert ###'})]};
    const list = parseCafes(data, 48.2, 16.37, null);
    assert.deepEqual(list.map(c => c.id), ['2']);
    assert.equal(list[0].oh, null);
});

const wien = n => ({elements: Array.from({length: n}, (_, i) => node(i + 1, {amenity: 'cafe'}, 48.2082 + (i < 100 ? 0 : 0.5), 16.3738))});
const resp = (ok, body, status = ok ? 200 : 500) => ({ok, status, json: async () => body});

test('fetchCafes in Wien: kaputte oder zu kleine wien.json führt zum Live-Fallback', async t => {
    for (const bad of [resp(false, {}, 404), resp(true, {elements: []})]) {
        const urls = [];
        t.mock.method(globalThis, 'fetch', async u => { urls.push(String(u)); return urls.length === 1 ? bad : resp(true, {elements: [node(5, {amenity: 'cafe'})]}); });
        const r = await fetchCafes(48.2082, 16.3738, 'cafe');
        assert.deepEqual(urls, ['data/wien.json', '/api/overpass?lat=48.2082&lng=16.3738&ptype=cafe']);
        assert.equal(r.elements[0].id, 5);
        t.mock.restoreAll();
    }
});

test('fetchCafes in Wien: nutzt wien.json und filtert auf den Radius', async t => {
    const urls = [];
    t.mock.method(globalThis, 'fetch', async u => { urls.push(u); return resp(true, wien(150)); });
    const r = await fetchCafes(48.2082, 16.3738, 'cafe');
    assert.deepEqual(urls, ['data/wien.json']);
    assert.equal(r.elements.length, 100); // die 50 weit entfernten fallen heraus
    await fetchCafes(48.2082, 16.3738, 'cafe');
    assert.equal(urls.length, 1, 'zweiter Aufruf aus dem Speicher');
});

test('fetchCafes außerhalb Wiens: Abfrage über den Proxy', async t => {
    const urls = [];
    t.mock.method(globalThis, 'fetch', async u => { urls.push(String(u)); return resp(true, {elements: [node(9, {amenity: 'cafe'}, 52.52, 13.405)]}); });
    const r = await fetchCafes(52.52, 13.405, 'bar');
    assert.deepEqual(urls, ['/api/overpass?lat=52.52&lng=13.405&ptype=bar']);
    assert.equal(r.elements[0].id, 9);
    assert.equal(inWien(52.52, 13.405), false);
});

test('fetchCafes: fällt auf direkte Overpass-Server zurück, wenn der Proxy ausfällt', async t => {
    const urls = [];
    t.mock.method(globalThis, 'fetch', async u => { urls.push(String(u)); return urls.length === 1 ? resp(false, {}, 502) : resp(true, {elements: []}); });
    const r = await fetchCafes(40.4168, -3.7038, 'cafe');
    assert.match(urls[0], /^\/api\/overpass/);
    assert.match(urls[1], /^https:\/\/.*overpass/);
    assert.deepEqual(r.elements, []);
});

test('geocode: Treffer, Nichtfund und Fehler', async t => {
    t.mock.method(globalThis, 'fetch', async () => resp(true, [{lat: '48.2', lon: '16.37', address: {country_code: 'at', state: 'Wien'}}]));
    assert.deepEqual(await geocode('Stephansplatz'), {lat: 48.2, lng: 16.37, rg: {country_code: 'at', state: 'Wien'}});
    t.mock.method(globalThis, 'fetch', async () => resp(true, []));
    assert.equal(await geocode('xyzzy-unbekannt'), null);
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
    assert.equal(await geocode('offline-ort'), null);
});

test('geocode wartet die Nominatim-Pause ab, statt die Anfrage zu verwerfen', async t => {
    const at = [];
    t.mock.method(globalThis, 'fetch', async () => { at.push(Date.now()); return resp(true, [{lat: '1', lon: '2'}]); });
    await geocode('ort-a'); await geocode('ort-b');
    assert.equal(at.length, 2);
    assert.ok(at[1] - at[0] >= 1000, 'mindestens ~1 s Abstand');
});

test('fetchWeather: liefert Reihen und Zeitzone, wirft bei HTTP-Fehler', async t => {
    t.mock.method(globalThis, 'fetch', async () => resp(true, {timezone: 'Europe/Vienna', hourly: {time: [1760000000], temperature_2m: [12], cloud_cover: [30]}}));
    const w = await fetchWeather(48.2, 16.37);
    assert.equal(w.tz, 'Europe/Vienna'); assert.deepEqual(w.wx.T, [12]); assert.equal(w.wx.t0.getTime(), 1760000000000);
    t.mock.method(globalThis, 'fetch', async () => resp(false, {reason: 'limit'}, 429));
    await assert.rejects(fetchWeather(48.2, 16.37), /HTTP 429/);
});
