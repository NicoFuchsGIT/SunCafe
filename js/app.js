// ---------- Einstellungen ----------
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'; // TODO: gegen Protomaps/PMTiles tauschen
const WIEN = {lat: 48.2082, lng: 16.3738};
const OVERPASS = ['https://overpass-api.de/api/interpreter','https://lz4.overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://overpass.openstreetmap.fr/api/interpreter'];
const CAFE_RADIUS = 1000, RINGS = [300, 600, 1050], STEP_MIN = 30, TERRACE_OFFSET = 4, MIN_ALT = 0, SHADOW_REACH = 300, BAD_CHAINS = ['der mann','aida','felber','ströck','stroeck','anker','unbekannt','tchibo', 'geier', 'admiral sportsbar', 'wild bean cafe'];
const DAYS = ['So','Mo','Di','Mi','Do','Fr','Sa'];

// ---------- Zustand ----------
let place = {...WIEN}, cafes = [], wx = null, t0 = null, popup = null, mapReady = false, osrv = 0, lastNom = 0;
const $ = id => document.getElementById(id);
const fmtT = d => d.toLocaleTimeString('de-AT', {hour:'2-digit', minute:'2-digit'});
const fmtD = d => DAYS[d.getDay()] + ' ' + fmtT(d);
const curTime = () => new Date(t0.getTime() + $('slider').value * STEP_MIN * 60000);

// ---------- Karte ----------
const map = new maplibregl.Map({container:'map', style:STYLE_URL, center:[place.lng, place.lat], zoom:15.5, attributionControl:false});
map.addControl(new maplibregl.AttributionControl({compact:true, customAttribution:'© OpenStreetMap contributors'}));
map.addControl(new maplibregl.NavigationControl({showCompass:false}), 'top-right');
const geo = new maplibregl.GeolocateControl({positionOptions:{enableHighAccuracy:true}, trackUserLocation:false, showUserLocation:false});
map.addControl(geo, 'top-right');
geo.on('geolocate', p => setPlace(p.coords.latitude, p.coords.longitude, false));

// Neuer Knopf: Suchen an der aktuellen Kartenmitte
class SearchCenterControl {
    onAdd(map) {
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = 'Ort manuell wählen';
        btn.innerHTML = '📍';
        btn.style.fontSize = '16px';
        btn.onclick = () => {
            // 1. Fadenkreuz & Bestätigen-Button einblenden
            $('center-marker').classList.remove('hidden-ui');
            $('confirm-place-btn').classList.remove('hidden-ui');

            // 2. Liste einklappen, falls sie offen ist
            const appDiv = $('app');
            if (!appDiv.classList.contains('collapsed')) {
                appDiv.classList.add('collapsed');
                updateSidebarIcon(true);
                setTimeout(() => map.resize(), 50);
            }
        };
        this._container.appendChild(btn);
        return this._container;
    }
    onRemove() { this._container.remove(); }
}
map.addControl(new SearchCenterControl(), 'top-right');

map.on('load', () => {
    map.addSource('cafes', {type:'geojson', data:{type:'FeatureCollection', features:[]}});
    map.addSource('center', {type:'geojson', data:{type:'FeatureCollection', features:[]}});
    map.addLayer({id:'center', type:'circle', source:'center', paint:{'circle-radius':6,'circle-color':'#3b82f6','circle-stroke-width':3,'circle-stroke-color':'#fff'}});
    map.addLayer({id:'cafes', type:'circle', source:'cafes', paint:{
            'circle-radius':['interpolate',['linear'],['zoom'],12,5,16,10],
            'circle-color':['match',['get','s'],'sun','#ffb703','shade','#6c7a89','#b8c0cc'],
            'circle-opacity':['case',['==',['get','o'],0],0.4,1],
            'circle-stroke-width':1.5,
            'circle-stroke-color':'#ffffff'}});
    map.addSource('terr', {type:'geojson', data:{type:'FeatureCollection', features:[]}});
    map.addLayer({id:'terr', type:'circle', source:'terr', paint:{'circle-radius':6, 'circle-color':['match',['get','s'],'sun','#ffb703','#6c7a89'], 'circle-stroke-width':2.5, 'circle-stroke-color':'#14213d'}});
    map.on('click', 'cafes', e => { openPopup(e.features[0].properties.id); });
    map.on('mouseenter','cafes',()=>map.getCanvas().style.cursor='pointer');
    map.on('mouseleave','cafes',()=>map.getCanvas().style.cursor='');
    mapReady = true;
    const fallback = () => setPlace(WIEN.lat, WIEN.lng, false);
    navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => setPlace(p.coords.latitude, p.coords.longitude), fallback, {timeout:8000, maximumAge:60000}) : fallback();
});

// ---------- Daten laden (Overpass, Cache, Rotation) ----------
async function overpass(q, key, ms) {
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
        $('status').textContent = 'Lade Cafés …';
        j = await ask('/api/overpass?data=' + encodeURIComponent(q));
    } catch(e) {
        err = e;
        for (let i = 0; i < OVERPASS.length && !j; i++) {
            const url = OVERPASS[(osrv + i) % OVERPASS.length];
            $('status').textContent = 'Lade Daten von ' + new URL(url).host + ' …';
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

let wienCache = null; // Speichert die wien.json im Arbeitsspeicher, sobald sie einmal geladen wurde

const fetchCafes = async (lat, lng) => {
    // 1. Prüfen, ob der gesuchte Ort im 6km-Radius des vorgerenderten Wiens liegt
    const distToZentrum = Math.hypot((lng - 16.3738) * 111320 * Math.cos(lat * Math.PI / 180), (lat - 48.2082) * 111320);

    if (distToZentrum < 6000) {
        if (!wienCache) {
            const r = await fetch('data/wien.json');
            wienCache = await r.json();
        }

        // Wir filtern die riesige Wien-Datei exakt auf den aktuellen 1km Suchradius des Nutzers
        return {
            elements: wienCache.elements.filter(e => {
                const elLat = e.lat ?? e.center?.lat;
                const elLng = e.lon ?? e.center?.lon;
                if (!elLat) return false;
                const d = Math.hypot((elLng - lng) * 111320 * Math.cos(lat * Math.PI / 180), (elLat - lat) * 111320);
                return d <= CAFE_RADIUS;
            })
        };
    }

    // 2. Fallback: Der Nutzer ist außerhalb von Wien (z. B. in Graz). Dann live über Overpass!
    const a = `(around:${CAFE_RADIUS},${lat},${lng});`;
    const v = $('ptype') ?$('ptype').value : 'cafe';

    let q = `nwr["amenity"="cafe"]${a}nwr["shop"="bakery"]${a}`;
    if (v === 'bar' || v === 'rest') q += `nwr["amenity"="bar"]${a}nwr["amenity"="pub"]${a}`;
    if (v === 'rest') q += `nwr["amenity"="restaurant"]${a}`;
    q += `nwr["leisure"="outdoor_seating"]${a}`;

    return overpass(`[out:json][timeout:25];(${q});out body center;`, `sc:c2:${v}:${lat},${lng}`, 25000);
};

// ---------- Gebäude aus Kartenkacheln (unsichtbare Zweitkarte) ----------
let bmap = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function loadBuildings(lat, lng) {
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
        const rh = +f.properties.render_height, h = rh > 5 ? rh : 15; // unbekannte Höhe: 15 m
        for (const poly of polys) {
            const ring = poly[0], key = ring[0][0].toFixed(6) + ',' + ring[0][1].toFixed(6) + ',' + ring.length;
            if (seen.has(key)) continue; seen.add(key);
            els.push({type:'way', tags:{building:'yes', height:String(h)}, geometry:ring.map(c => ({lat:c[1], lon:c[0]}))});
        }
    }
    return {elements:els};
}

// ---------- Aufbereitung ----------
const polyContains = (pts, x, y) => { let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
        if ((pts[i][1] > y) !== (pts[j][1] > y) && x < (pts[j][0]-pts[i][0]) * (y-pts[i][1]) / (pts[j][1]-pts[i][1]) + pts[i][0]) c = !c;
    return c; };

function parseCafes(data, lat0, lng0) {
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 111320;
    const terr = data.elements.filter(e => e.tags && (e.tags.leisure === 'outdoor_seating' || e.tags.amenity === 'biergarten'))
        .map(e => ({lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon})).filter(t => t.lat != null);
    const v = $('ptype').value;
    const list = data.elements.filter(e => {
        if (!e.tags) return false;
        const am = e.tags.amenity, sh = e.tags.shop;
        let ok = (am === 'cafe' || sh === 'bakery');
        if (v === 'bar' || v === 'rest') ok = ok || am === 'bar' || am === 'pub';
        if (v === 'rest') ok = ok || am === 'restaurant';
        return ok && !BAD_CHAINS.some(k => (e.tags.name || 'unbekannt').toLowerCase().includes(k));
    }).map(e => {
        const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
        if (lat == null) return null;
        let oh = null; const raw = e.tags.opening_hours;
        if (raw) { try { oh = new opening_hours(raw, {lat, lon:lng, address:{country_code:'at'}}, {locale:'de'}); } catch(x) { oh = null; } }
        return {id:String(e.id), name:e.tags.name || 'Café ohne Namen', lat, lng, loc:[], calc:false, terr:[], oh, raw,
            dist:Math.hypot((lng - lng0) * kx, (lat - lat0) * ky), outdoor:e.tags.outdoor_seating,
            addr:[e.tags['addr:street'], e.tags['addr:housenumber']].filter(Boolean).join(' ')};
    }).filter(Boolean);
    for (const t of terr) { // OSM-Terrasse gehört zum nächsten Café innerhalb von 25 m
        let best = null, bd = 25;
        for (const c of list) { const d = Math.hypot((t.lng - c.lng) * kx, (t.lat - c.lat) * ky); if (d < bd) { bd = d; best = c; } }
        if (best) best.terr.push(t);
    }
    return list;
}

// ---------- Terrassenposition ----------
const SIDES = ['Nord','Nordost','Ost','Südost','Süd','Südwest','West','Nordwest'];
const sideName = (nx, ny) => 'Seite ' + SIDES[(Math.round(Math.atan2(nx, ny) / (Math.PI / 4)) + 8) % 8];

function segDist(p) { // kleinster Abstand des Café-Punkts (0,0) zum Gebäuderand
    let m = Infinity;
    for (let i = 0; i < p.length - 1; i++) {
        const ex = p[i+1][0] - p[i][0], ey = p[i+1][1] - p[i][1], l2 = ex * ex + ey * ey;
        let s = l2 ? -(p[i][0] * ex + p[i][1] * ey) / l2 : 0; s = Math.max(0, Math.min(1, s));
        m = Math.min(m, Math.hypot(p[i][0] + s * ex, p[i][1] + s * ey));
    }
    return m;
}

function rayHits(x, y, dx, dy, maxD, blds) {
    for (const b of blds) {
        const p = b.pts;
        for (let i = 0; i < p.length - 1; i++) {
            const ax = p[i][0] - x, ay = p[i][1] - y, ex = p[i+1][0] - p[i][0], ey = p[i+1][1] - p[i][1], den = dx * ey - dy * ex;
            if (Math.abs(den) < 1e-9) continue;
            const t = (ax * ey - ay * ex) / den, u = (ax * dy - ay * dx) / den;
            if (u >= 0 && u <= 1 && t > 0.05 && t <= maxD) return true;
        }
    }
    return false;
}

function facadePoints(own, near, owns) {
    const blds = near.concat(owns), p = own.pts, edges = [];
    for (let i = 0; i < p.length - 1; i++) {
        const ex = p[i+1][0] - p[i][0], ey = p[i+1][1] - p[i][1], len = Math.hypot(ex, ey);
        if (len < 3) continue;
        let s = -(p[i][0] * ex + p[i][1] * ey) / (len * len); s = Math.max(0, Math.min(1, s));
        const qx = p[i][0] + s * ex, qy = p[i][1] + s * ey;
        let nx = ey / len, ny = -ex / len;
        if (polyContains(p, qx + nx * 0.5, qy + ny * 0.5)) { nx = -nx; ny = -ny; } // Normale zeigt nach außen
        edges.push({qx, qy, nx, ny, d: Math.hypot(qx, qy)});
    }
    edges.sort((a, b) => a.d - b.d);
    const out = [];
    for (const e of edges) {
        if (e.d > edges[0].d + 25 || out.length >= 4) break;
        if (out.some(o => o.nx * e.nx + o.ny * e.ny > 0.82)) continue; // fast gleiche Richtung: schon vorhanden
        const x = e.qx + e.nx * TERRACE_OFFSET, y = e.qy + e.ny * TERRACE_OFFSET;
        if (blds.some(b => polyContains(b.pts, x, y))) continue; // Nachbarhaus an dieser Wand
        let hits = 0;
        for (let k = 0; k < 8; k++) if (rayHits(x, y, Math.sin(k * Math.PI / 4), Math.cos(k * Math.PI / 4), 25, blds)) hits++;
        out.push({x, y, nx: e.nx, ny: e.ny, label: sideName(e.nx, e.ny), enclosed: hits >= 7, kind: 'facade'});
    }
    const open = out.filter(o => !o.enclosed);
    return open.length ? open : out;
}

function terracePoints(c, kx, ky) {
    if (c.terr.length) return c.terr.map(t => ({x: (t.lng - c.lng) * kx, y: (t.lat - c.lat) * ky, label: 'Terrasse (OSM)', kind: 'osm'}));
    if (c.owns.length) { const f = facadePoints(c.owns[0], c.near, c.owns); if (f.length) return f; }
    return [{x: 0, y: 0, label: 'Position laut OSM', kind: 'point'}];
}

function showTerr(c) {
    const kx = 111320 * Math.cos(c.lat * Math.PI / 180);
    map.getSource('terr').setData({type:'FeatureCollection', features:(c.pts || []).map((p, i) => ({type:'Feature',
        geometry:{type:'Point', coordinates:[c.lng + p.x / kx, c.lat + p.y / 111320]},
        properties:{s: c.res && c.res[i] === false ? 'sun' : 'shade'}}))});
}

function attachBuildings(list, data) {
    const bl = data.elements.filter(e => e.type === 'way' && e.tags && e.tags.building && e.geometry).map(e => {
        const t = e.tags;
        const h = t.height ? (parseFloat(String(t.height).replace('m','').trim()) || 15) : t['building:levels'] ? (parseFloat(t['building:levels']) || 5) * 3 : 15;
        return {h, g:e.geometry};
    });
    for (const c of list) {
        const kx = 111320 * Math.cos(c.lat * Math.PI / 180), ky = 111320;
        c.loc = []; c.owns = [];
        for (const b of bl) {
            if (Math.abs((b.g[0].lon - c.lng) * kx) > SHADOW_REACH + 150 || Math.abs((b.g[0].lat - c.lat) * ky) > SHADOW_REACH + 150) continue;
            const pts = b.g.map(p => [(p.lon - c.lng) * kx, (p.lat - c.lat) * ky]);
            if (!pts.some(p => Math.abs(p[0]) < SHADOW_REACH && Math.abs(p[1]) < SHADOW_REACH)) continue;
            if (polyContains(pts, 0, 0)) c.owns.push({h:b.h, pts, d:0}); // Gebäude des Cafés
            else c.loc.push({h:b.h, pts, d:segDist(pts)});
        }
        c.near = c.loc.filter(b => b.d < 45);
        c.occ = c.loc.concat(c.owns); // das eigene Gebäude wirft Schatten auf die Terrasse
        c.pts = terracePoints(c, kx, ky);
        for (const pt of c.pts) pt.skip = c.near.concat(c.owns).filter(b => polyContains(b.pts, pt.x, pt.y));
        c.calc = true;
    }
}

// ---------- Rechnung ----------
function inShade(c, pt, alt, az) { // az: Kompass, Richtung zur Sonne; pt: Terrassenpunkt relativ zum Café
    const dx = Math.sin(az), dy = Math.cos(az), ta = Math.tan(Math.max(alt, 0.5 * Math.PI / 180)), po = Math.hypot(pt.x, pt.y);
    for (const b of c.occ) {
        const reach = Math.min(b.h / ta, SHADOW_REACH);
        if (b.d - po > reach || pt.skip.includes(b)) continue;
        const p = b.pts;
        for (let i = 0; i < p.length - 1; i++) {
            const ax = p[i][0] - pt.x, ay = p[i][1] - pt.y, ex = p[i+1][0] - p[i][0], ey = p[i+1][1] - p[i][1], den = dx * ey - dy * ex;
            if (Math.abs(den) < 1e-9) continue;
            const t = (ax * ey - ay * ex) / den, u = (ax * dy - ay * dx) / den;
            if (u >= 0 && u <= 1 && t > 0.05 && t <= reach) return true;
        }
    }
    return false;
}

function openInfo(c, d) {
    if (!c.oh) return {o:-1, text:'Öffnungszeiten unbekannt'};
    try {
        const next = c.oh.getNextChange(d), nt = next ? (next.toDateString() === d.toDateString() ? fmtT(next) : fmtD(next)) : null;
        if (c.oh.getUnknown(d)) return {o:-1, text:'Öffnungszeiten unklar' + (c.raw ? ': ' + c.raw : '')};
        if (c.oh.getState(d)) return {o:1, text:'Geöffnet' + (nt ? ', schließt ' + nt : '')};
        return {o:0, text:'Geschlossen' + (nt ? ', öffnet ' + nt : '')};
    } catch(e) { return {o:-1, text:'Öffnungszeiten unlesbar'}; }
}

// ---------- Anzeige ----------
function update() {
    if (!mapReady || !t0) return;
    const d = curTime(), s = d.getTime() === t0.getTime();
    $('tlabel').textContent = s ? 'Jetzt' : fmtD(d);
    const sp = SunCalc.getPosition(d, place.lat, place.lng), alt = sp.altitude, az = sp.azimuth + Math.PI;
    const night = alt < MIN_ALT;
    document.documentElement.classList.toggle('dark', night);
    $('sunstate').textContent = night ? 'Sonne unter dem Horizont' : 'Sonnenhöhe ' + Math.round(alt * 180 / Math.PI) + '°';
    showWx(d);
    const onlyOpen = $('fopen').checked, onlySun = $('fsun').checked;
    const rows = [];
    for (const c of cafes) {
        if (night) c.state = 'night';
        else if (!c.calc) c.state = 'pending';
        else {
            c.res = c.pts.map(p => inShade(c, p, alt, az));
            const sunny = c.res.filter(x => !x).length;
            c.state = sunny ? 'sun' : 'shade';
            c.partial = sunny > 0 && sunny < c.res.length;
            c.hof = c.pts.every(p => p.enclosed);
        }
        c.info = openInfo(c, d);
        if (onlyOpen && c.info.o === 0) continue;
        if (onlySun && (c.state !== 'sun' || c.hof)) continue;
        rows.push(c);
    }
    map.getSource('cafes').setData({type:'FeatureCollection', features:rows.map(c => ({type:'Feature',
            geometry:{type:'Point', coordinates:[c.lng, c.lat]}, properties:{id:c.id, s:c.state, o:c.info.o}}))});
    rows.sort((a, b) => a.dist - b.dist);
    const L = $('list'); L.innerHTML = '';
    for (const c of rows.slice(0, 80)) {
        const li = document.createElement('li'); li.tabIndex = 0;
        li.className = c.info.o === 0 ? 'closed' : '';
        li.innerHTML = `<span class="dot ${c.state}"></span><div><div class="nm"></div><div class="sub"></div></div><span class="dist">${c.dist < 1000 ? Math.round(c.dist) + ' m' : (c.dist/1000).toFixed(1) + ' km'}</span>`;
        li.querySelector('.nm').textContent = c.name;
        li.querySelector('.sub').textContent = stateText(c) + (c.hof && c.state !== 'night' ? ' (Innenhof möglich)' : '') + ' · ' + c.info.text;
        const go = () => { map.flyTo({center:[c.lng, c.lat], zoom:Math.max(map.getZoom(), 16.5)}); openPopup(c.id); };
        li.onclick = go; li.onkeydown = e => { if (e.key === 'Enter') go(); };
        L.appendChild(li);
    }
    $('status').textContent = `${rows.length} von ${cafes.length} Cafés` + (night ? ' · Nacht, keine Sonne' : '') + (cafes.some(c => !c.calc) ? ' · Schatten wird berechnet ...' : '');
    if (popup && popup._cid) openPopup(popup._cid);
}
const stateText = c => c.state === 'sun' && c.partial ? 'Teils Sonne' : ({sun:'Sonne', shade:'Schatten', night:'Nacht', pending:'Schatten nicht berechnet'})[c.state];
function openPopup(id) {
    const c = cafes.find(x => x.id === id); if (!c) return;
    if (popup) popup.remove();
    const out = c.outdoor === 'yes' ? 'Außenplätze: ja' : c.outdoor === 'no' ? 'Außenplätze: nein' : 'Außenplätze: unbekannt';
    const sides = c.res && c.state !== 'night' ? c.pts.map((p, i) => `${p.label}: ${c.res[i] ? 'Schatten' : 'Sonne'}${p.enclosed ? ' (Innenhof möglich)' : ''}`) : [];
    const dest = c.lat + ',' + c.lng;
    const view = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(c.addr ? `${c.name}, ${c.addr}` : `${c.name} ${dest}`);

    const el = document.createElement('div');

    // Kleines Google Maps Icon oben rechts
    const gmapsLink = document.createElement('a');
    gmapsLink.href = view;
    gmapsLink.target = '_blank';
    gmapsLink.rel = 'noopener';
    gmapsLink.className = 'gmaps-icon';
    gmapsLink.title = 'In Google Maps ansehen';
    gmapsLink.innerHTML = '🗺️'; // Du kannst auch '🗺️' oder ein SVG einfügen
    el.appendChild(gmapsLink);

    const b = document.createElement('b');
    b.textContent = c.name; el.appendChild(b);

    [stateText(c) + (c.calc ? ' (Gebäudeschatten, Näherung)' : ''), ...sides, c.info.text, out, c.addr].filter(Boolean).forEach(t => {
        const p = document.createElement('p'); p.textContent = t; el.appendChild(p); });

    popup = new maplibregl.Popup({closeButton:true, closeOnClick:false, offset:12}).setLngLat([c.lng, c.lat]).setDOMContent(el).addTo(map);
    popup._cid = id;
    showTerr(c);
    popup.on('close', () => { if (popup && popup._cid === id) { popup._cid = null; map.getSource('terr').setData({type:'FeatureCollection', features:[]}); } });
}

// ---------- Wetter ----------
async function loadWx(lat, lng) {
    wx = null;
    try {
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,cloud_cover&forecast_days=3&timezone=auto`);
        const j = await r.json(); wx = {t0:new Date(j.hourly.time[0]), T:j.hourly.temperature_2m, C:j.hourly.cloud_cover};
    } catch(e) {}
    showWx(curTime());
}
function showWx(d) {
    if (!wx) { $('wx').textContent = 'Wetter nicht verfügbar'; return; }
    const i = Math.round((d - wx.t0) / 3600000);
    $('wx').textContent = wx.T[i] == null ? '' : `${Math.round(wx.T[i])} °C · Bewölkung ${wx.C[i]} %`;
}

// ---------- Ort setzen ----------
async function setPlace(lat, lng, move = true) {
    const mine = place = {lat, lng};
    if (popup) { popup.remove(); popup = null; }
    map.getSource('center').setData({type:'Point', coordinates:[lng, lat]});
    if (move) map.flyTo({center:[lng, lat], zoom:Math.max(map.getZoom(), 15.5)});

    // 1. NEU: Distanzen der BEREITS GELADENEN Orte sofort aktualisieren
    const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 111320;
    for (const c of cafes) {
        c.dist = Math.hypot((c.lng - lng) * kx, (c.lat - lat) * ky);
    }

    $('status').textContent = 'Lade neue Orte im Umkreis …';
    loadWx(lat, lng);
    const now = new Date(); now.setMinutes(Math.floor(now.getMinutes() / STEP_MIN) * STEP_MIN, 0, 0); t0 = now;
    $('slider').value = 0;

    // Wir rufen sofort update() auf! Dadurch sortiert sich die Liste links sofort
    // nach der neuen Distanz, noch bevor Overpass geantwortet hat.
    update();

    const rl = +lat.toFixed(3), rg = +lng.toFixed(3);
    try {
        const list = parseCafes(await fetchCafes(rl, rg), lat, lng);
        if (place !== mine) return;

        // 2. NEU: Merge statt Überschreiben! Wir fügen nur Orte hinzu, die wir noch nicht kennen.
        const existingIds = new Set(cafes.map(c => c.id));
        let addedCount = 0;
        for (const c of list) {
            if (!existingIds.has(c.id)) {
                cafes.push(c);
                addedCount++;
            }
        }
        console.log(`Cache: ${existingIds.size} Orte bekannt, ${addedCount} neu hinzugefügt.`);
    } catch(e) {
        if (place !== mine) return;
        if (cafes.length === 0) {
            $('status').textContent = 'Orte konnten nicht geladen werden (Overpass nicht erreichbar).';
        } else {
            $('status').textContent = 'Fehler beim Nachladen. Zeige bisherige Orte.';
        }
        return;
    }

    // Zweites Update: Jetzt werden die alten + die neu geladenen Orte zusammen angezeigt
    update();
    if (!cafes.length) { $('status').textContent = 'Bisher keine Orte gefunden.'; return; }

    try {
        // Gebäude für die Schattenberechnung nachladen
        const data = await loadBuildings(lat, lng);
        if (place !== mine) return;
        if (!data.elements.length) throw new Error('keine Gebäude');
        for (const r of RINGS) {
            // Schatten wird nur für Orte berechnet, die ihn noch nicht haben (!c.calc)
            attachBuildings(cafes.filter(c => !c.calc && c.dist <= r), data);
            update();
            await sleep(30);
            if (place !== mine) return;
        }
        $('status').textContent = `${cafes.length} Orte insgesamt im Speicher.`;
    } catch(e) {
        if (place === mine) $('status').textContent = `${cafes.length} Orte · Schatten derzeit nicht verfügbar`;
    }
}

// ---------- Bedienung ----------
let raf = 0;
$('slider').addEventListener('input', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
$('fopen').onchange = $('fsun').onchange = update;
// Lädt die Karte neu, sobald das Dropdown geändert wird
$('ptype').addEventListener('change', () => {
    if (mapReady && t0) setPlace(place.lat, place.lng, false); // false = Kamera nicht bewegen
});
$('q').addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    const q = e.target.value.trim(); if (!q) return;
    const key = 'nom:' + q.toLowerCase();
    let hit = null;
    try { hit = JSON.parse(localStorage.getItem(key)); } catch(x) {}
    if (!hit) {
        if (Date.now() - lastNom < 1100) return; lastNom = Date.now();
        try {
            const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q));
            const j = await r.json(); if (j[0]) { hit = {lat:+j[0].lat, lng:+j[0].lon};
                try { localStorage.setItem(key, JSON.stringify(hit)); } catch(x) {} }
        } catch(x) {}
    }
    if (hit) setPlace(hit.lat, hit.lng); else $('status').textContent = 'Adresse nicht gefunden.';
});

// ---------- Info-Dialog ----------
const info = $('info');
$('info-btn').onclick = () => info.showModal();
info.querySelector('.info-x').onclick = () => info.close();
info.addEventListener('click', e => { if (e.target === info) info.close(); }); // Klick auf den Hintergrund schließt

// ---------- Sidebar & Auswahl-Logik ----------

// Hilfsfunktion, um die Pfeile richtig zu setzen
function updateSidebarIcon(isCollapsed) {
    if (window.innerWidth <= 760) {
        $('ts-icon').textContent = isCollapsed ? '▲' : '▼';
    } else {
        $('ts-icon').textContent = isCollapsed ? '▶' : '◀';
    }
}

// Manueller Klick auf den "Liste"-Button
$('toggle-sidebar').onclick = () => {
    const appDiv = $('app');
    appDiv.classList.toggle('collapsed');
    updateSidebarIcon(appDiv.classList.contains('collapsed'));
    setTimeout(() => map.resize(), 50);
};

// Klick auf "✅ Hier suchen"
$('confirm-place-btn').onclick = () => {
    // 1. Die exakte Mitte der Karte auslesen
    const c = map.getCenter();

    // 2. UI wieder verstecken
    $('center-marker').classList.add('hidden-ui');
    $('confirm-place-btn').classList.add('hidden-ui');

    // 3. Liste wieder ausklappen
    const appDiv = $('app');
    appDiv.classList.remove('collapsed');
    updateSidebarIcon(false);

    // 4. Karte anpassen und suchen!
    setTimeout(() => {
        map.resize();
        setPlace(c.lat, c.lng); // Löst die Suche am neuen Ort aus
    }, 50);
};