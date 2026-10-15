// ---------- Datenquellen: Overpass, wien.json, Nominatim, Open-Meteo, Kartenkacheln ----------
// Kein Zugriff auf die Seite: Statusmeldungen gehen über den Callback onStatus.
import {STYLE_URL, WIEN, WIEN_RANGE, OVERPASS, CAFE_RADIUS, TERRACE_MATCH_RADIUS, DEFAULT_HEIGHT, BAD_CHAIN_RE} from './config.js';
import {M_PER_DEG, kxAt, distM} from './geo.js';
import {parseHours} from './hours.js';
import {t} from './i18n.js';
import {tileKey, decodePoints} from './horizon.js';

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const inWien = (lat, lng) => distM(lat, lng, WIEN.lat, WIEN.lng) < WIEN_RANGE;

// ---------- Overpass (Cache, Rotation) ----------
let osrv = 0;
async function overpass(q, proxy, key, ms, onStatus) { // proxy: Pfad der Vercel-Funktion, die q selbst baut
    try { const c = sessionStorage.getItem(key); if (c) return JSON.parse(c); } catch(e) {}
    const ask = async (url, init) => {
        const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), ms);
        try {
            const r = await fetch(url, {...init, signal:ctl.signal});
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return await r.json();
        } finally { clearTimeout(to); }
    };
    let j, err;
    try {
        onStatus(t('status.loading'));
        j = await ask(proxy);
    } catch(e) {
        err = e;
        for (let i = 0; i < OVERPASS.length && !j; i++) {
            const url = OVERPASS[(osrv + i) % OVERPASS.length];
            onStatus(t('status.loadingFrom', {host: new URL(url).host}));
            try {
                j = await ask(url, {method:'POST', body:'data=' + encodeURIComponent(q), headers:{'Content-Type':'application/x-www-form-urlencoded'}});
                osrv = (osrv + i) % OVERPASS.length;
            } catch(x) { err = x; }
        }
    }
    if (!j) throw err;
    try { sessionStorage.setItem(key, JSON.stringify(j)); } catch(e) {}
    return j;
}

let wienCache = null;
// ptype: 'cafe' | 'bar' | 'rest'
export async function fetchCafes(lat, lng, ptype = 'cafe', onStatus = () => {}) {

    // 1. Versuch: Der Wien-Turbo
    if (inWien(lat, lng)) {
        try {
            if (!wienCache) {
                const r = await fetch('data/wien.json');
                if (!r.ok) throw new Error(`HTTP Error ${r.status}`);
                wienCache = await r.json();
                if (!wienCache || !wienCache.elements || wienCache.elements.length < 100) throw new Error('Datei enthält keine validen Elemente');
            }

            // Filtern der Daten auf den aktuellen 1km-Radius
            return {
                elements: wienCache.elements.filter(e => {
                    const elLat = e.lat ?? e.center?.lat;
                    const elLng = e.lon ?? e.center?.lon;
                    if (!elLat) return false;
                    return distM(lat, lng, elLat, elLng) <= CAFE_RADIUS;
                })
            };
        } catch (err) {
            console.warn("Turbo fehlgeschlagen, lade live:", err.message);
            wienCache = null; // Cache leeren, falls die Datei kaputt war
            // Die Funktion bricht hier nicht ab, sondern rutscht automatisch zum Live-Fallback durch!
        }
    }

    // 2. Live-Fallback: Greift außerhalb von Wien ODER wenn wien.json einen Fehler wirft
    return overpass(cafeQuery(lat, lng, ptype), `/api/overpass?lat=${lat}&lng=${lng}&ptype=${ptype}`, `sc:c2:${ptype}:${lat},${lng}`, 25000, onStatus);
}

// Overpass-Abfrage für Orte um (lat, lng); auch api/overpass.js baut sie hiermit, damit der Proxy keine fremden Abfragen annimmt
export function cafeQuery(lat, lng, ptype = 'cafe') {
    const a = `(around:${CAFE_RADIUS},${lat},${lng});`;
    let q = `nwr["amenity"="cafe"]${a}nwr["shop"="bakery"]${a}`;
    if (ptype === 'bar' || ptype === 'rest') q += `nwr["amenity"="bar"]${a}nwr["amenity"="pub"]${a}`;
    if (ptype === 'rest') q += `nwr["amenity"="restaurant"]${a}`;
    q += `nwr["leisure"="outdoor_seating"]${a}`;
    return `[out:json][timeout:25];(${q});out body center;`;
}

// ---------- Vorberechnete Horizontmasken für Wien (data/horizon/<Kachel>.json) ----------
// Setzt c.pts und c.calc für alle Orte, die in einer Kachel stehen; fehlende Kacheln oder Orte rechnet der Client selbst.
const horizonTiles = new Map(); // Kachel → Promise (Objekt oder null)
export async function loadHorizon(list) {
    await Promise.all(list.filter(c => !c.calc && inWien(c.lat, c.lng)).map(async c => {
        const k = tileKey(c.lat, c.lng);
        if (!horizonTiles.has(k)) horizonTiles.set(k, fetch(`data/horizon/${k}.json`).then(r => r.ok ? r.json() : null).catch(() => null));
        const pts = (await horizonTiles.get(k))?.[c.id];
        const dec = pts && decodePoints(pts);
        if (dec) { c.pts = dec; c.calc = true; }
    }));
}

// ---------- Nominatim (max. 1 Anfrage pro Sekunde) ----------
let lastNom = 0;
async function nomSlot() { const w = lastNom + 1100 - Date.now(); if (w > 0) await sleep(w); lastNom = Date.now(); }

// Land/Bundesland für Feiertage
export async function region(lat, lng) {
    if (inWien(lat, lng)) return {country_code:'at', state:'Wien'};
    const key = 'rg:' + lat.toFixed(1) + ',' + lng.toFixed(1);
    try { const c = JSON.parse(localStorage.getItem(key)); if (c) return c; } catch(x) {}
    try {
        await nomSlot();
        // Bundesländer auf Deutsch, so heißen sie in den Feiertagsdaten von opening_hours (z. B. „Bayern“)
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=5&accept-language=de&lat=${lat}&lon=${lng}`);
        const a = (await r.json()).address;
        if (a && a.country_code) {
            const rg = {country_code:a.country_code, state:a.state};
            try { localStorage.setItem(key, JSON.stringify(rg)); } catch(x) {}
            return rg;
        }
    } catch(x) {}
    return null;
}

// Adresssuche: {lat, lng, rg} oder null; wartet bei Bedarf, bis die Nominatim-Pause (1,1 s) vorbei ist
export async function geocode(q) {
    const key = 'nom:' + q.toLowerCase();
    let hit = null;
    try { hit = JSON.parse(localStorage.getItem(key)); } catch(x) {}
    if (hit) return hit;
    await nomSlot();
    try {
        const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&accept-language=de&q=' + encodeURIComponent(q));
        const j = await r.json(); const a = j[0] && j[0].address;
        if (j[0]) { hit = {lat:+j[0].lat, lng:+j[0].lon, rg:a && a.country_code ? {country_code:a.country_code, state:a.state} : null};
            try { localStorage.setItem(key, JSON.stringify(hit)); } catch(x) {} }
    } catch(x) {}
    return hit;
}

// ---------- Wetter (Open-Meteo) ----------
// {wx, tz}; wirft bei Fehlern
export async function fetchWeather(lat, lng) {
    // unixtime: Zeitpunkte unabhängig von der Browser-Zeitzone; timezone=auto liefert die Zeitzone des Orts
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,cloud_cover&forecast_days=3&timezone=auto&timeformat=unixtime`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return {wx:{t0:new Date(j.hourly.time[0] * 1000), T:j.hourly.temperature_2m, C:j.hourly.cloud_cover}, tz:j.timezone};
}

// ---------- Gebäude aus Kartenkacheln (unsichtbare Zweitkarte, braucht maplibregl) ----------
let bmap = null;
export async function loadBuildings(lat, lng) {
    if (!bmap) {
        const div = document.createElement('div');
        div.style.cssText = 'position:fixed;left:-9999px;top:0;width:1100px;height:1100px';
        document.body.appendChild(div);
        bmap = new maplibregl.Map({container:div, style:STYLE_URL, center:[lng, lat], zoom:15, interactive:false, attributionControl:false, fadeDuration:0});
        await new Promise(r => bmap.once('load', r));
    } else { bmap.jumpTo({center:[lng, lat], zoom:15}); await sleep(300); }
    if (!bmap.loaded()) await Promise.race([new Promise(r => bmap.once('idle', r)), sleep(10000)]);
    const srcs = bmap.getStyle().sources, src = Object.keys(srcs).find(k => srcs[k].type === 'vector');
    const feats = src ? bmap.querySourceFeatures(src, {sourceLayer:'building'}) : [];
    const seen = new Set(), els = [];
    for (const f of feats) {
        const g = f.geometry; if (!g) continue;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        const rh = +f.properties.render_height, h = rh > 0 && rh !== 5 ? rh : DEFAULT_HEIGHT; // 5 = OpenMapTiles-Default ohne height/levels → unbekannt
        for (const poly of polys) {
            const ring = poly[0], key = ring[0][0].toFixed(6) + ',' + ring[0][1].toFixed(6) + ',' + ring.length;
            if (seen.has(key)) continue; seen.add(key);
            els.push({type:'way', tags:{building:'yes', height:String(h)}, geometry:ring.map(c => ({lat:c[1], lon:c[0]}))});
        }
    }
    return {elements:els};
}

// ---------- Aufbereitung: OSM-Elemente → Café-Objekte ----------
export function parseCafes(data, lat0, lng0, rg, ptype = 'cafe') {
    const kx = kxAt(lat0), ky = M_PER_DEG;
    const terr = data.elements.filter(e => e.tags && (e.tags.leisure === 'outdoor_seating' || e.tags.amenity === 'biergarten'))
        .map(e => ({lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon})).filter(t => t.lat != null);
    const list = data.elements.filter(e => {
        if (!e.tags) return false;
        const am = e.tags.amenity, sh = e.tags.shop;
        let ok = (am === 'cafe' || sh === 'bakery');
        if (ptype === 'bar' || ptype === 'rest') ok = ok || am === 'bar' || am === 'pub';
        if (ptype === 'rest') ok = ok || am === 'restaurant';
        return ok && !BAD_CHAIN_RE.test(e.tags.name || '');
    }).map(e => {
        const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
        if (lat == null) return null;
        const raw = e.tags.opening_hours;
        return {id:String(e.id), osmId:e.type + '/' + e.id, name:e.tags.name || '', lat, lng, loc:[], calc:false, terr:[], oh:parseHours(raw, lat, lng, rg), raw,
            dist:Math.hypot((lng - lng0) * kx, (lat - lat0) * ky), outdoor:e.tags.outdoor_seating,
            addr:[e.tags['addr:street'], e.tags['addr:housenumber']].filter(Boolean).join(' ')};
    }).filter(Boolean);
    for (const t of terr) { // OSM-Terrasse gehört zum nächsten Café innerhalb von TERRACE_MATCH_RADIUS
        let best = null, bd = TERRACE_MATCH_RADIUS;
        for (const c of list) { const d = Math.hypot((t.lng - c.lng) * kx, (t.lat - c.lat) * ky); if (d < bd) { bd = d; best = c; } }
        if (best) best.terr.push(t);
    }
    return list;
}
