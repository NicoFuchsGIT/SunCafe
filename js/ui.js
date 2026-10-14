// ---------- Einstiegspunkt: Karte, Zustand, Anzeige, Bedienung ----------
import {STYLE_URL, WIEN, RINGS, STEP_MIN, MIN_ALT, EYE_HEIGHT} from './config.js';
import {M_PER_DEG, kxAt} from './geo.js';
import {attachBuildings} from './shade.js';
import {attachMasks, maskShade} from './horizon.js';
import {sunTrack, sunMinutes} from './sunminutes.js';
import {wall, fmtD, openInfo} from './hours.js';
import {sleep, fetchCafes, region, geocode, fetchWeather, loadBuildings, loadHorizon, parseCafes} from './data.js';

// ---------- Zustand ----------
let place = {...WIEN}, cafes = [], wx = null, t0 = null, popup = null, mapReady = false, tz = null;
const $ = id => document.getElementById(id);
const setStatus = t => { $('status').textContent = t; };
// Schieber auf 0 ist „Jetzt“: echte Uhrzeit statt t0, das auf STEP_MIN abgerundet ist und beim Offenlassen veraltet
const curTime = () => +$('slider').value ? new Date(t0.getTime() + $('slider').value * STEP_MIN * 60000) : new Date();

// ---------- Karte ----------
const map = new maplibregl.Map({container:'map', style:STYLE_URL, center:[place.lng, place.lat], zoom:15.5, attributionControl:false});
map.addControl(new maplibregl.AttributionControl({compact:true, customAttribution:'© OpenStreetMap contributors'}));
map.addControl(new maplibregl.NavigationControl({showCompass:false}), 'top-right');
const geo = new maplibregl.GeolocateControl({positionOptions:{enableHighAccuracy:true}, trackUserLocation:false, showUserLocation:false});
map.addControl(geo, 'top-right');
geo.on('geolocate', p => setPlace(p.coords.latitude, p.coords.longitude, false));

// Neuer Knopf: Suchen an der aktuellen Kartenmitte
class SearchCenterControl {
    onAdd() {
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = 'Ort manuell wählen';
        btn.innerHTML = '📍';
        btn.style.fontSize = '16px';
        btn.onclick = () => setPicking($('confirm-place-btn').classList.contains('hidden-ui')); // zweiter Klick bricht ab
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
    map.on('click', 'cafes', e => select(e.features[0].properties.id));
    map.on('mouseenter','cafes',()=>map.getCanvas().style.cursor='pointer');
    map.on('mouseleave','cafes',()=>map.getCanvas().style.cursor='');
    mapReady = true;
    const fallback = () => setPlace(WIEN.lat, WIEN.lng, false);
    navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => setPlace(p.coords.latitude, p.coords.longitude), fallback, {timeout:8000, maximumAge:60000}) : fallback();
});

// ---------- Terrassenpunkte auf der Karte ----------
function showTerr(c) {
    const kx = kxAt(c.lat);
    map.getSource('terr').setData({type:'FeatureCollection', features:(c.pts || []).map((p, i) => ({type:'Feature',
        geometry:{type:'Point', coordinates:[c.lng + p.x / kx, c.lat + p.y / M_PER_DEG]},
        properties:{s: c.res && c.res[i] === false ? 'sun' : 'shade'}}))});
}

// ---------- Anzeige ----------
function update() {
    if (!mapReady || !t0) return;
    const d = curTime(), s = !+$('slider').value, w = wall(d, tz);
    $('tlabel').textContent = s ? 'Jetzt' : fmtD(w);
    const sp = SunCalc.getPosition(d, place.lat, place.lng), alt = sp.altitude, az = sp.azimuth + Math.PI;
    const night = alt < MIN_ALT;
    document.documentElement.classList.toggle('dark', night);
    $('sunstate').textContent = night ? 'Sonne unter dem Horizont' : 'Sonnenhöhe ' + Math.round(alt * 180 / Math.PI) + '°';
    showWx(d);
    const onlyOpen = $('fopen').checked, onlySun = $('fsun').checked;
    const rows = [];
    for (const c of cafes) {
        if (night) { c.state = 'night'; c.res = null; } // sonst färbt showTerr nachts mit dem letzten Tageswert
        else if (!c.calc) c.state = 'pending';
        else {
            c.res = c.pts.map(p => maskShade(p.mask, alt, az)); // Masken-Lookup, keine Strahlengeometrie pro Schieberschritt
            const sunny = c.res.filter(x => !x).length;
            c.state = sunny ? 'sun' : 'shade';
            c.partial = sunny > 0 && sunny < c.res.length;
            c.hof = c.pts.every(p => p.enclosed);
        }
        c.info = openInfo(c, w);
        if (onlyOpen && c.info.o === 0) continue;
        if (onlySun && (c.state !== 'sun' || c.hof)) continue;
        rows.push(c);
    }
    map.getSource('cafes').setData({type:'FeatureCollection', features:rows.map(c => ({type:'Feature',
            geometry:{type:'Point', coordinates:[c.lng, c.lat]}, properties:{id:c.id, s:c.state, o:c.info.o}}))});
    // Sonnenminuten im Fenster ab d (F3.1); Sonnenstand einmal für alle, null solange Schatten fehlt
    const track = sunTrack(d, x => SunCalc.getPosition(x, place.lat, place.lng), tz);
    for (const c of rows) c.sunMin = sunMinutes(c, track);
    const bySun = $('fsort').value === 'sun', sm = c => c.sunMin ?? -1;
    rows.sort((a, b) => (bySun ? sm(b) - sm(a) : 0) || a.dist - b.dist);
    // Das gewählte Café steht immer oben, auch wenn es sonst nicht unter den ersten 80 wäre oder ausgefiltert ist
    const sel = popup && cafes.find(c => c.id === popup._cid);
    if (sel) sel.sunMin = sunMinutes(sel, track);
    const shown = sel ? [sel, ...rows.filter(c => c !== sel)] : rows;
    const L = $('list'); L.innerHTML = '';
    for (const c of shown.slice(0, 80)) {
        const li = document.createElement('li'); li.tabIndex = 0;
        li.className = c.info.o === 0 ? 'closed' : ''; li.dataset.id = c.id;
        li.innerHTML = `<span class="dot ${c.state}"></span><div><div class="nm"></div><div class="sub"></div></div><span class="meta"><span class="sm"></span><span class="dist">${c.dist < 1000 ? Math.round(c.dist) + ' m' : (c.dist/1000).toFixed(1) + ' km'}</span></span>`;
        if (c.sunMin != null) li.querySelector('.sm').textContent = '☀️ ' + c.sunMin + ' min';
        li.querySelector('.nm').textContent = c.name;
        li.querySelector('.sub').textContent = stateText(c) + (c.hof && c.state !== 'night' ? ' (Innenhof möglich)' : '') + ' · ' + c.info.text;
        const go = () => { map.flyTo({center:[c.lng, c.lat], zoom:Math.max(map.getZoom(), 16.5)}); select(c.id); };
        li.onclick = go; li.onkeydown = e => { if (e.key === 'Enter') go(); };
        L.appendChild(li);
    }
    $('status').textContent = `${rows.length} von ${cafes.length} Cafés` + (night ? ' · Nacht, keine Sonne' : '') + (cafes.some(c => !c.calc) ? ' · Schatten wird berechnet ...' : '');
    if (popup && popup._cid) openPopup(popup._cid);
}
// Café in der Liste markieren, bei Klick auf der Karte auch hinscrollen; id null hebt die Markierung auf
function markList(id, scroll = false) {
    for (const li of $('list').children) {
        const on = li.dataset.id === id;
        li.classList.toggle('sel', on);
        if (on && scroll) li.scrollIntoView({block:'nearest', behavior:'smooth'});
    }
}
// Café auswählen: Popup öffnen, Liste neu aufbauen (gewähltes Café oben) und hinscrollen
function select(id) { openPopup(id); update(); markList(id, true); }
const stateText = c => c.state === 'sun' && c.partial ? 'Teils Sonne' : ({sun:'Sonne', shade:'Schatten', night:'Nacht', pending:'Schatten nicht berechnet'})[c.state];
function openPopup(id) {
    const c = cafes.find(x => x.id === id); if (!c) return;
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

    // gleiches Café: nur Inhalt tauschen; neues Popup oder setDOMContent holt den Fokus, z. B. vom Schieber
    if (popup && popup._cid === id) { popup._el.replaceChildren(...el.childNodes); showTerr(c); return; }
    if (popup) popup.remove();
    popup = new maplibregl.Popup({closeButton:true, closeOnClick:false, offset:12}).setLngLat([c.lng, c.lat]).setDOMContent(el).addTo(map);
    popup._cid = id; popup._el = el;
    showTerr(c);
    markList(id);
    popup.on('close', () => { if (popup && popup._cid === id) { popup._cid = null; markList(null); map.getSource('terr').setData({type:'FeatureCollection', features:[]}); } });
}

// ---------- Wetter ----------
async function loadWx(lat, lng) {
    const mine = place;
    wx = null;
    try {
        const r = await fetchWeather(lat, lng);
        if (place !== mine) return;
        wx = r.wx;
        tz = r.tz;
    } catch(e) {}
    if (place === mine) update();
}
function showWx(d) {
    if (!wx) { $('wx').textContent = 'Wetter nicht verfügbar'; return; }
    const i = Math.round((d - wx.t0) / 3600000);
    $('wx').textContent = wx.T[i] == null ? '' : `${Math.round(wx.T[i])} °C · Bewölkung ${wx.C[i]} %`;
}

// ---------- Ort setzen ----------
async function setPlace(lat, lng, move = true, knownRg = null) {
    const mine = place = {lat, lng};
    const rgP = knownRg ? Promise.resolve(knownRg) : region(lat, lng);
    if (popup) { popup.remove(); popup = null; }
    map.getSource('center').setData({type:'Point', coordinates:[lng, lat]});
    if (move) map.flyTo({center:[lng, lat], zoom:Math.max(map.getZoom(), 15.5)});

    // 1. NEU: Distanzen der BEREITS GELADENEN Orte sofort aktualisieren
    const kx = kxAt(lat), ky = M_PER_DEG;
    for (const c of cafes) {
        c.dist = Math.hypot((c.lng - lng) * kx, (c.lat - lat) * ky);
    }

    $('status').textContent = 'Lade neue Orte im Umkreis …';
    loadWx(lat, lng);
    // Gewählte Uhrzeit beim Ortswechsel behalten; „Jetzt“ (Schieber auf 0) bleibt „Jetzt“
    const sl = $('slider'), keep = t0 && +sl.value ? curTime() : null;
    const now = new Date(); now.setMinutes(Math.floor(now.getMinutes() / STEP_MIN) * STEP_MIN, 0, 0); t0 = now;
    sl.value = keep ? Math.max(0, Math.min(+sl.max, Math.round((keep - t0) / (STEP_MIN * 60000)))) : 0;

    // Wir rufen sofort update() auf! Dadurch sortiert sich die Liste links sofort
    // nach der neuen Distanz, noch bevor Overpass geantwortet hat.
    update();

    const rl = +lat.toFixed(3), rg = +lng.toFixed(3);
    try {
        const ptype = $('ptype').value;
        const [data, reg] = await Promise.all([fetchCafes(rl, rg, ptype, setStatus), rgP]);
        const list = parseCafes(data, lat, lng, reg, ptype);
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

    await loadHorizon(cafes); // Wien: vorberechnete Masken mit echten Höhen und Gelände
    if (place !== mine) return;
    update();
    if (!cafes.some(c => !c.calc && c.dist <= RINGS[RINGS.length - 1])) { $('status').textContent = `${cafes.length} Orte insgesamt im Speicher.`; return; }

    try {
        // Gebäude für die Schattenberechnung nachladen (außerhalb Wiens oder ohne Kachel)
        const data = await loadBuildings(lat, lng);
        if (place !== mine) return;
        if (!data.elements.length) throw new Error('keine Gebäude');
        for (const r of RINGS) {
            // Schatten wird nur für Orte berechnet, die ihn noch nicht haben (!c.calc)
            const todo = cafes.filter(c => !c.calc && c.dist <= r);
            attachBuildings(todo, data);
            for (const c of todo) attachMasks(c, EYE_HEIGHT); // Horizontmasken einmal pro Messpunkt, aus Augenhöhe
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
$('fopen').onchange = $('fsun').onchange = $('fsort').onchange = update;
// Lädt die Karte neu, sobald das Dropdown geändert wird
$('ptype').addEventListener('change', () => {
    if (!mapReady || !t0) return;
    cafes = []; // Liste leeren, sonst bleiben Orte der vorherigen Kategorie stehen
    setPlace(place.lat, place.lng, false);
});
$('q').addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    const q = e.target.value.trim(); if (!q) return;
    const hit = await geocode(q);
    if (hit === undefined) return; // letzte Anfrage weniger als 1,1 s her
    if (hit) setPlace(hit.lat, hit.lng, true, hit.rg); else $('status').textContent = 'Adresse nicht gefunden.';
});

// ---------- Info-Dialog ----------
const info = $('info');
$('info-btn').onclick = () => info.showModal();
info.querySelector('.info-x').onclick = () => info.close();
info.addEventListener('click', e => { if (e.target === info) info.close(); }); // Klick auf den Hintergrund schließt

// ---------- Sidebar & Auswahl-Logik ----------

// Pfeil passend zu Layout (mobil: Liste unten) und Zustand
const mobile = matchMedia('(max-width:760px)');
function updateSidebarIcon() {
    const c = $('app').classList.contains('collapsed');
    $('ts-icon').textContent = mobile.matches ? (c ? '▲' : '▼') : (c ? '▶' : '◀');
    $('toggle-sidebar').setAttribute('aria-expanded', String(!c));
}
updateSidebarIcon();
mobile.addEventListener('change', updateSidebarIcon);

// Ort wählen: Pin in der Kartenmitte und „Hier suchen“ einblenden, Liste dafür einklappen
function setPicking(on) {
    $('center-marker').classList.toggle('hidden-ui', !on);
    $('confirm-place-btn').classList.toggle('hidden-ui', !on);
    $('app').classList.toggle('collapsed', on);
    updateSidebarIcon();
    setTimeout(() => map.resize(), 50);
}

// Manueller Klick auf den "Liste"-Button
$('toggle-sidebar').onclick = () => {
    $('app').classList.toggle('collapsed');
    updateSidebarIcon();
    setTimeout(() => map.resize(), 50);
};

// Klick auf "✅ Hier suchen"
$('confirm-place-btn').onclick = () => {
    const c = map.getCenter();
    setPicking(false);
    setTimeout(() => setPlace(c.lat, c.lng), 60); // nach dem resize, sonst fliegt die Karte zur alten Mitte
};
