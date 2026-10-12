// ---------- Einstiegspunkt: Karte, Zustand, Anzeige, Bedienung ----------
import {STYLE_URL, WIEN, RINGS, STEP_MIN, MIN_ALT} from './config.js';
import {M_PER_DEG, kxAt} from './geo.js';
import {attachBuildings, inShade} from './shade.js';
import {wall, fmtD, openInfo} from './hours.js';
import {sleep, fetchCafes, region, geocode, fetchWeather, loadBuildings, parseCafes} from './data.js';

// ---------- Zustand ----------
let place = {...WIEN}, cafes = [], wx = null, t0 = null, popup = null, mapReady = false, tz = null;
const $ = id => document.getElementById(id);
const setStatus = t => { $('status').textContent = t; };
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
    const d = curTime(), s = d.getTime() === t0.getTime(), w = wall(d, tz);
    $('tlabel').textContent = s ? 'Jetzt' : fmtD(w);
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
        c.info = openInfo(c, w);
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
    const now = new Date(); now.setMinutes(Math.floor(now.getMinutes() / STEP_MIN) * STEP_MIN, 0, 0); t0 = now;
    $('slider').value = 0;

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
