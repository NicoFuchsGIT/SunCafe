// ---------- Einstiegspunkt: Karte, Zustand, Anzeige, Bedienung ----------
import {STYLE_URL, WIEN, RINGS, STEP_MIN, MIN_ALT, EYE_HEIGHT, CAFE_RADIUS, SORT_SUN_MAX_M} from './config.js';
import {M_PER_DEG, kxAt} from './geo.js';
import {attachBuildings} from './shade.js';
import {attachMasks, maskShade} from './horizon.js';
import {sunTrack, sunMinutes} from './sunminutes.js';
import {wall, fmtD, openInfo} from './hours.js';
import {deviceId, votedRecently, markVoted, buildVote, checkOnSite, sendVote} from './vote.js';
import {t, getLang, setLang, applyStatic, fmtDist} from './i18n.js';
import {sleep, fetchCafes, region, geocode, fetchWeather, loadBuildings, loadHorizon, parseCafes, inWien} from './data.js';
import {CHIPS, chipSlot} from './timechips.js';
import {isApple, googleUrl, appleUrl} from './route.js';

// ---------- Zustand ----------
let voteOnSite = false, voteMsg = {};
const voteBusy = new Set(), voteErr = new Set(); // pro Café: Senden läuft / letzter Versuch fehlgeschlagen (überlebt das Neuaufbauen des Sheets)
let place = {...WIEN}, cafes = [], wx = null, t0 = null, curId = null, mapReady = false, tz = null;
const $ = id => document.getElementById(id);
const setStatus = msg => { $('status').textContent = msg; };
// Schieber auf 0 ist „Jetzt“: echte Uhrzeit statt t0, das auf STEP_MIN abgerundet ist und beim Offenlassen veraltet
const curTime = () => +$('slider').value ? new Date(t0.getTime() + $('slider').value * STEP_MIN * 60000) : new Date();

// ---------- Karte ----------
const map = new maplibregl.Map({container:'map', style:STYLE_URL, center:[place.lng, place.lat], zoom:15.5, attributionControl:false});
map.addControl(new maplibregl.AttributionControl({compact:true, customAttribution:'© OpenStreetMap · OpenFreeMap · Stadt Wien'}));
map.addControl(new maplibregl.NavigationControl({showCompass:false}), 'top-right'); // mobil per CSS ausgeblendet (Pinch)

const icon = n => `<svg class="icon" aria-hidden="true"><use href="#i-${n}"/></svg>`;


// Marker tragen die Information im Symbol, nicht nur in der Farbe (E12): Sonne, Teils, Schatten, Nacht, offen/unberechnet, geschlossen
const MARKS = {
    sun: {fill:'#ffb703', ink:'#14213d', rim:'#14213d', glyph:'sun'},
    partial: {fill:'#ffb703', ink:'#14213d', rim:'#14213d', glyph:'partial'},
    shade: {fill:'#6c7a89', ink:'#ffffff', rim:'#14213d', glyph:'shade'},
    night: {fill:'#14213d', ink:'#e8edf4', rim:'#14213d', glyph:'night'},
    pending: {fill:'#b8c0cc', ink:'#14213d', rim:'#14213d', glyph:''},
    closed: {fill:'#ffffff', ink:'#5d6b7e', rim:'#5d6b7e', glyph:'', path:'<path d="M6 12h12"/>'},
};
function markerImage(key) {
    const m = MARKS[key], g = m.path || (m.glyph ? document.getElementById('i-' + m.glyph).innerHTML : '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#fff"/>` +
        `<circle cx="32" cy="32" r="26.5" fill="${m.fill}" stroke="${m.rim}" stroke-width="3"/>` +
        `<g transform="translate(15.8 15.8) scale(1.35)" fill="none" stroke="${m.ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${g}</g></svg>`;
    return new Promise(res => {
        const img = new Image();
        img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 64, 64); res(x.getImageData(0, 0, 64, 64)); };
        img.onerror = () => res(null);
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
}

map.on('load', async () => {
    map.addSource('cafes', {type:'geojson', data:{type:'FeatureCollection', features:[]}});
    map.addSource('center', {type:'geojson', data:{type:'FeatureCollection', features:[]}});
    map.addLayer({id:'center', type:'circle', source:'center', paint:{'circle-radius':6,'circle-color':'#3b82f6','circle-stroke-width':3,'circle-stroke-color':'#fff'}});
    const keys = Object.keys(MARKS), imgs = await Promise.all(keys.map(markerImage));
    if (imgs.every(Boolean)) {
        keys.forEach((k, i) => map.addImage('m-' + k, imgs[i], {pixelRatio:2}));
        map.addLayer({id:'cafes', type:'symbol', source:'cafes',
            layout:{'icon-image':['concat','m-',['get','ic']], 'icon-size':['interpolate',['linear'],['zoom'],12,.55,16,.85,18,1], 'icon-allow-overlap':true, 'icon-ignore-placement':true}});
    } else { // Fallback ohne Symbole: farbige Kreise wie bisher
        map.addLayer({id:'cafes', type:'circle', source:'cafes', paint:{
            'circle-radius':['interpolate',['linear'],['zoom'],12,5,16,10],
            'circle-color':['match',['get','s'],'sun','#ffb703','shade','#6c7a89','#b8c0cc'],
            'circle-opacity':['case',['==',['get','o'],0],0.4,1],
            'circle-stroke-width':1.5, 'circle-stroke-color':'#ffffff'}});
    }
    map.addSource('terr', {type:'geojson', data:{type:'FeatureCollection', features:[]}});
    map.addLayer({id:'terr', type:'circle', source:'terr', paint:{'circle-radius':6, 'circle-color':['match',['get','s'],'sun','#ffb703','#6c7a89'], 'circle-stroke-width':2.5, 'circle-stroke-color':'#14213d'}});
    map.on('click', 'cafes', e => select(e.features[0].properties.id));
    map.on('click', e => { if (curId && !map.queryRenderedFeatures(e.point, {layers:['cafes']}).length) closeSheet(); }); // leere Fläche schließt das Sheet
    map.on('mouseenter','cafes',()=>map.getCanvas().style.cursor='pointer');
    map.on('mouseleave','cafes',()=>map.getCanvas().style.cursor='');
    mapReady = true;
    locate();
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
    $('tlabel').textContent = s ? t('time.now') : fmtD(w);
    $('preview').hidden = s;
    $('slider').setAttribute('aria-valuetext', $('tlabel').textContent);
    const sp = SunCalc.getPosition(d, place.lat, place.lng), alt = sp.altitude, az = sp.azimuth + Math.PI;
    const night = alt < MIN_ALT;
    document.documentElement.classList.toggle('dark', night);
    $('sunstate').textContent = night ? t('sun.below') : t('sun.alt', {deg: Math.round(alt * 180 / Math.PI)});
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
            geometry:{type:'Point', coordinates:[c.lng, c.lat]},
            properties:{id:c.id, s:c.state, o:c.info.o, ic:c.info.o === 0 ? 'closed' : c.state === 'sun' && c.partial ? 'partial' : c.state}}))});
    // Sonnenminuten im Fenster ab d (F3.1); Sonnenstand einmal für alle, null solange Schatten fehlt
    const track = sunTrack(d, x => SunCalc.getPosition(x, place.lat, place.lng), tz);
    for (const c of rows) c.sunMin = sunMinutes(c, track);
    // „Meiste Sonne“ reiht nur Orte bis SORT_SUN_MAX_M vorn ein (zu Fuß erreichbar), weiter entfernte folgen nach Entfernung
    const bySun = $('fsort').value === 'sun', sm = c => c.sunMin ?? -1, far = c => c.dist > SORT_SUN_MAX_M;
    rows.sort((a, b) => bySun ? (far(a) - far(b)) || (far(a) ? 0 : sm(b) - sm(a)) || a.dist - b.dist : a.dist - b.dist);
    // Das gewählte Café steht immer oben, auch wenn es sonst nicht unter den ersten 80 wäre oder ausgefiltert ist
    const sel = curId && cafes.find(c => c.id === curId);
    if (sel) sel.sunMin = sunMinutes(sel, track);
    const shown = sel ? [sel, ...rows.filter(c => c !== sel)] : rows;
    const L = $('list'); L.innerHTML = '';
    for (const c of shown.slice(0, 80)) {
        const li = document.createElement('li'); li.tabIndex = 0;
        li.className = c.info.o === 0 ? 'closed' : ''; li.dataset.id = c.id;
        li.innerHTML = `<span class="dot ${c.state}"></span><div><div class="nm"></div><div class="sub"></div></div><span class="meta"><span class="sm"></span><span class="dist">${fmtDist(c.dist)}</span></span>`;
        if (c.sunMin != null) li.querySelector('.sm').innerHTML = icon('sun') + ' ' + t('sunmin', {n: c.sunMin});
        li.querySelector('.nm').textContent = c.name || t('cafe.noName');
        li.querySelector('.sub').textContent = stateText(c) + (c.hof && c.state !== 'night' ? t('state.courtyard') : '') + ' · ' + c.info.text;
        const go = () => { setView('map'); select(c.id, true); };
        li.onclick = go; li.onkeydown = e => { if (e.key === 'Enter') go(); };
        L.appendChild(li);
    }
    $('status').textContent = t('status.count', {n: rows.length, total: cafes.length}) + (night ? t('status.night') : '') + (cafes.some(c => !c.calc) ? t('status.calc') : '');
    updateChips();
    if (curId) openSheet(curId);
}
// Café in der Liste markieren, bei Klick auf der Karte auch hinscrollen; id null hebt die Markierung auf
function markList(id, scroll = false) {
    for (const li of $('list').children) {
        const on = li.dataset.id === id;
        li.classList.toggle('sel', on);
        if (on && scroll) li.scrollIntoView({block:'nearest', behavior:'smooth'});
    }
}
// Café auswählen: Sheet öffnen, Karte so schieben, dass der Marker über dem Sheet liegt, Liste neu aufbauen (gewähltes Café oben)
function select(id, zoomIn = false) {
    const c = cafes.find(x => x.id === id); if (!c) return;
    closeFilters();
    openSheet(id);
    layoutVars();
    const cam = {center:[c.lng, c.lat], padding:{top:0, left:0, right:0, bottom:$('sheet').offsetHeight + dockTop() + 24}};
    if (zoomIn) cam.zoom = Math.max(map.getZoom(), 16.5);
    map.easeTo(cam);
    update(); markList(id, true);
}
const stateText = c => c.state === 'sun' && c.partial ? t('state.partial') : t('state.' + c.state);
// „Stimmt das gerade?“ mit drei Knöpfen (F4.1); optional Standortprüfung (F4.4)
function voteBox(c) {
    const box = document.createElement('div'); box.className = 'vote';
    const q = document.createElement('div'); q.className = 'vote-q'; q.textContent = t('vote.q'); box.appendChild(q);
    if (c.state === 'night') { box.hidden = true; return box; } // nachts gibt es nichts zu bewerten
    const note = txt => { const n = document.createElement('p'); n.className = 'vote-note'; n.textContent = txt; box.appendChild(n); };
    const sp = SunCalc.getPosition(new Date(), c.lat, c.lng);
    const payload = +$('slider').value ? null : buildVote(c, {alt: sp.altitude, az: sp.azimuth + Math.PI, device: deviceId()});
    if (!payload) { if (+$('slider').value) note(t('vote.nowonly')); else box.hidden = true; return box; }
    if (voteBusy.has(c.id)) { note(t('vote.busy')); return box; } // kein Doppelversand beim Neuaufbau
    if (voteMsg[c.id] || votedRecently(c.id)) { note(t(voteMsg[c.id] || 'vote.thanks')); return box; }
    const row = document.createElement('div'); row.className = 'vote-row';
    const btns = ['sun', 'part', 'shade'].map(v => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'vote-btn';
        b.classList.add('v-' + v); b.innerHTML = icon({sun: 'sun', part: 'partial', shade: 'shade'}[v]) + ' <span></span>';
        b.lastChild.textContent = t('vote.' + v); row.appendChild(b);
        b.onclick = async () => {
            if (voteBusy.has(c.id)) return;
            voteBusy.add(c.id); voteErr.delete(c.id); btns.forEach(x => { x.disabled = true; }); note(t('vote.busy'));
            const onSite = voteOnSite && await checkOnSite(c);
            // Zeitstempel und Sonnenstand erst jetzt, die Standortabfrage kann dauern (API erlaubt ±10 min)
            const sp2 = SunCalc.getPosition(new Date(), c.lat, c.lng);
            const fresh = buildVote(c, {alt: sp2.altitude, az: sp2.azimuth + Math.PI, onSite, device: deviceId()});
            const r = fresh ? await sendVote(fresh, v) : 'error';
            voteBusy.delete(c.id);
            if (r === 'ok') { markVoted(c.id); voteMsg[c.id] = onSite || !voteOnSite ? 'vote.thanks' : 'vote.thanks.off'; }
            else if (r === 'limit') voteMsg[c.id] = 'vote.limit';
            else voteErr.add(c.id);
            if (curId === c.id) openSheet(c.id); // Inhalt neu aufbauen
        };
        return b;
    });
    box.appendChild(row);
    if (voteErr.has(c.id)) note(t('vote.error'));
    const lab = document.createElement('label'); lab.className = 'vote-site';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = voteOnSite; cb.onchange = () => { voteOnSite = cb.checked; };
    lab.append(cb, ' ' + t('vote.onsite')); box.appendChild(lab);
    return box;
}
const APPLE = isApple(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
function openSheet(id) {
    const c = cafes.find(x => x.id === id); if (!c) return;
    const out = t(c.outdoor === 'yes' ? 'out.yes' : c.outdoor === 'no' ? 'out.no' : 'out.unknown');
    const sides = c.res && c.state !== 'night' ? c.pts.map((p, i) => `${t('lbl.' + p.label)}: ${t(c.res[i] ? 'state.shade' : 'state.sun')}${p.enclosed ? t('state.courtyard') : ''}`) : [];
    const el = document.createElement('div');

    const h = document.createElement('h2'); h.id = 'sheet-name'; h.textContent = c.name || t('cafe.noName'); el.appendChild(h);

    // Sonnenstatus mit Symbol (Farbe trägt nicht allein), rechts die Sonnenminuten
    const st = document.createElement('div'); st.className = 'sheet-state';
    const key = c.state === 'sun' && c.partial ? 'partial' : c.state;
    st.innerHTML = key === 'pending' ? '' : icon(key === 'partial' ? 'partial' : key === 'sun' ? 'sun' : key === 'shade' ? 'shade' : 'night').replace('class="icon"', `class="icon st-${key}"`);
    const stTxt = document.createElement('span'); stTxt.textContent = stateText(c) + (c.calc ? t('state.approx') : ''); st.appendChild(stTxt);
    if (c.sunMin != null && c.state !== 'night') { const sm = document.createElement('span'); sm.className = 'sm'; sm.textContent = t('sunmin', {n: c.sunMin}); sm.title = t('sheet.sunMin', {n: c.sunMin}); st.appendChild(sm); }
    el.appendChild(st);

    [...sides, c.info.text, out, c.addr].filter(Boolean).forEach(txt => {
        const p = document.createElement('p'); p.textContent = txt; el.appendChild(p); });

    // Route zu Fuß mit Koordinaten (E5); auf Apple-Geräten Apple Karten zuerst, Google Maps als zweite Wahl
    const route = document.createElement('a'); route.className = 'btn-route'; route.target = '_blank'; route.rel = 'noopener';
    route.href = APPLE ? appleUrl(c.lat, c.lng) : googleUrl(c.lat, c.lng);
    route.innerHTML = icon('route') + ' <span></span>'; route.lastChild.textContent = t('sheet.route');
    el.appendChild(route);
    if (APPLE) { const alt = document.createElement('a'); alt.className = 'route-alt'; alt.target = '_blank'; alt.rel = 'noopener'; alt.href = googleUrl(c.lat, c.lng); alt.textContent = t('sheet.routeGoogle'); el.appendChild(alt); }

    el.appendChild(voteBox(c));

    const fb = document.createElement('a');
    fb.className = 'fb-link'; fb.target = '_blank'; fb.rel = 'noopener'; fb.textContent = t('fb.link');
    const body = `${c.name || ''} (${c.id})\n${c.lat}, ${c.lng}\n${curTime().toISOString()}\n\n`;
    fb.href = 'https://github.com/NicoFuchsGIT/SunCafe/issues/new?title=' + encodeURIComponent(t('fb.title', {name: c.name || t('cafe.noName')})) + '&body=' + encodeURIComponent(body);
    el.appendChild(fb);

    // gleiches Café: nur Inhalt tauschen, damit der Fokus nicht vom Schieber springt
    const sheet = $('sheet'), first = sheet.hidden || curId !== id;
    $('sheet-body').replaceChildren(...el.childNodes);
    curId = id; sheet.hidden = false;
    showTerr(c);
    if (first) { markList(id); sheet.focus({preventScroll:true}); }
}
function closeSheet(instant = false) {
    if (!curId) return;
    curId = null; $('sheet').hidden = true; markList(null);
    map.getSource('terr').setData({type:'FeatureCollection', features:[]});
    const pad = {top:0, left:0, right:0, bottom:0};
    if (instant) map.jumpTo({padding:pad}); else map.easeTo({padding:pad});
}
$('sheet-x').onclick = () => closeSheet();

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
    if (!wx) { $('wx').textContent = t('wx.none'); return; }
    const i = Math.round((d - wx.t0) / 3600000);
    $('wx').textContent = wx.T[i] == null ? '' : t('wx.line', {t: Math.round(wx.T[i]), c: wx.C[i]});
}

// ---------- Ort setzen ----------
async function setPlace(lat, lng, move = true, knownRg = null) {
    const mine = place = {lat, lng};
    const rgP = knownRg ? Promise.resolve(knownRg) : region(lat, lng);
    closeSheet(true);
    map.getSource('center').setData({type:'Point', coordinates:[lng, lat]});
    if (move) map.flyTo({center:[lng, lat], zoom:Math.max(map.getZoom(), 15.5)});

    // 1. NEU: Distanzen der BEREITS GELADENEN Orte sofort aktualisieren
    const kx = kxAt(lat), ky = M_PER_DEG;
    for (const c of cafes) {
        c.dist = Math.hypot((c.lng - lng) * kx, (c.lat - lat) * ky);
    }

    $('status').textContent = t('status.loadingPlaces');
    showOutsideNotice(!inWien(lat, lng));
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
        // Orte, die beim Ortswechsel außer Reichweite geraten sind, verwerfen, sonst wachsen Liste und Speicher ohne Grenze
        cafes = cafes.filter(c => c.dist <= CAFE_RADIUS + 50);
        console.log(`Cache: ${existingIds.size} Orte bekannt, ${addedCount} neu hinzugefügt, ${cafes.length} im Radius.`);
    } catch(e) {
        if (place !== mine) return;
        if (cafes.length === 0) {
            $('status').textContent = t('status.failed');
        } else {
            $('status').textContent = t('status.failedMore');
        }
        return;
    }

    // Zweites Update: Jetzt werden die alten + die neu geladenen Orte zusammen angezeigt
    update();
    if (!cafes.length) { $('status').textContent = t('status.none'); return; }

    await loadHorizon(cafes); // Wien: vorberechnete Masken mit echten Höhen und Gelände
    if (place !== mine) return;
    update();
    if (!cafes.some(c => !c.calc && c.dist <= RINGS[RINGS.length - 1])) { $('status').textContent = t('status.total', {n: cafes.length}); return; }

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
        $('status').textContent = t('status.total', {n: cafes.length});
    } catch(e) {
        if (place === mine) $('status').textContent = t('status.noShade', {n: cafes.length});
    }
}

// ---------- Hinweis außerhalb Wiens (E8): einmal je Sitzung ----------
function showOutsideNotice(outside) {
    let seen = false;
    try { seen = sessionStorage.getItem('suncafe.outside') === '1'; } catch(e) {}
    $('notice').hidden = !outside || seen;
    if (outside && !seen) { try { sessionStorage.setItem('suncafe.outside', '1'); } catch(e) {} }
}
$('notice-x').onclick = () => { $('notice').hidden = true; };

// ---------- Standort: sofort fragen, bei Ablehnung „Wo bist du?“ statt stillem Wien ----------
function locate() {
    if (!navigator.geolocation) return askWhere('unavailable');
    navigator.geolocation.getCurrentPosition(
        p => { if ($('where').open) $('where').close(); setPlace(p.coords.latitude, p.coords.longitude); },
        err => askWhere(err && err.code === 1 ? 'denied' : 'unavailable'),
        {timeout:8000, maximumAge:60000});
}
function askWhere(reason) {
    $('where-msg').textContent = t(reason === 'denied' ? 'where.denied' : reason === 'notfound' ? 'status.notFound' : 'where.unavailable');
    if (!$('where').open) $('where').showModal();
    $('where-q').focus();
}
async function searchAddress(q, fail) {
    q = q.trim(); if (!q) return;
    const hit = await geocode(q);
    if (hit) { if ($('where').open) $('where').close(); setPlace(hit.lat, hit.lng, true, hit.rg); } else fail();
}
$('locate-btn').onclick = locate;
$('where-retry').onclick = locate;
$('where-pick').onclick = () => { $('where').close(); setPicking(true); };
$('where-center').onclick = () => { $('where').close(); setPlace(WIEN.lat, WIEN.lng); };
$('where-go').onclick = () => searchAddress($('where-q').value, () => askWhere('notfound'));
$('where-q').addEventListener('keydown', e => { if (e.key === 'Enter') $('where-go').click(); });

// ---------- Bedienung ----------
let raf = 0;
$('slider').addEventListener('input', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
$('fopen').onchange = $('fsun').onchange = $('fsort').onchange = () => { updateFilterBadge(); update(); };
// Lädt die Karte neu, sobald die Kategorie geändert wird
$('ptype').addEventListener('change', () => {
    syncCats(); updateFilterBadge();
    if (!mapReady || !t0) return;
    cafes = []; // Liste leeren, sonst bleiben Orte der vorherigen Kategorie stehen
    setPlace(place.lat, place.lng, false);
});
$('q').addEventListener('keydown', e => {
    if (e.key === 'Enter') searchAddress(e.target.value, () => { $('status').textContent = t('status.notFound'); $('where-q').value = e.target.value; askWhere('notfound'); });
});

// ---------- Zeit: Schnellwahl-Chips ----------
function chipSlots() {
    const now = new Date(), sl = $('slider');
    const sun = d => SunCalc.getTimes(d, place.lat, place.lng);
    const base = {now, t0, step:STEP_MIN, max:+sl.max, sunset:sun(now).sunset, sunriseNext:sun(new Date(now.getTime() + 864e5)).sunrise};
    return Object.fromEntries(CHIPS.map(k => [k, chipSlot(k, base)]));
}
function updateChips() {
    if (!t0) return;
    const slots = chipSlots(), v = +$('slider').value;
    for (const b of $('chips').children) {
        const k = b.dataset.chip, slot = slots[k];
        b.hidden = slot == null;
        b.setAttribute('aria-pressed', String(slot === v));
    }
}
$('chips').addEventListener('click', e => {
    const b = e.target.closest('[data-chip]'); if (!b || !t0) return;
    const slot = chipSlots()[b.dataset.chip]; if (slot == null) return;
    $('slider').value = slot; update();
});

// ---------- Sprache ----------
applyStatic();
const langSel = $('lang'); langSel.value = getLang();
langSel.onchange = () => { setLang(langSel.value); setView(view()); updateFilterBadge(); if (t0) update(); };

// ---------- Info-Dialog ----------
const info = $('info');
$('info-btn').onclick = () => info.showModal();
for (const d of document.querySelectorAll('dialog')) {
    d.querySelector('.info-x').onclick = () => d.close();
    d.addEventListener('click', e => { if (e.target === d) d.close(); }); // Klick auf den Hintergrund schließt
}

// ---------- Layout: Höhen von Topbar und Dock für Sheet, Liste und Karten-Steuerung ----------
const dockTop = () => Math.max(0, innerHeight - $('dock').getBoundingClientRect().top);
function layoutVars() {
    const root = document.documentElement.style;
    root.setProperty('--dock-top', dockTop() + 'px');
    const tb = $('topbar').getBoundingClientRect();
    root.setProperty('--top-h', Math.round(tb.bottom + 8) + 'px');
}
layoutVars();
if (window.ResizeObserver) { const ro = new ResizeObserver(layoutVars); ro.observe($('dock')); ro.observe($('topbar')); }
addEventListener('resize', layoutVars);

// ---------- Ansichten: Karte oder Vollbildliste (mobil), Filter-Panel ----------
const mobile = matchMedia('(max-width:760px)');
const view = () => $('app').dataset.view;
function setView(v, refocus = false) {
    $('app').dataset.view = v;
    const list = v === 'list';
    $('ts-use').setAttribute('href', list ? '#i-pin' : '#i-list');
    $('ts-text').dataset.i18n = list ? 'list.map' : 'list.btn';
    $('ts-text').textContent = t(list ? 'list.map' : 'list.btn');
    $('toggle-sidebar').setAttribute('aria-label', t(list ? 'list.close' : 'list.open'));
    $('toggle-sidebar').setAttribute('aria-expanded', String(list));
    $('toggle-sidebar').dataset.i18nAttr = 'aria-label:' + (list ? 'list.close' : 'list.open');
    if (list) { closeFilters(); if (mobile.matches) $('side').focus({preventScroll:true}); }
    else if (refocus) $('toggle-sidebar').focus();
}
$('toggle-sidebar').onclick = () => setView(view() === 'list' ? 'map' : 'list', true);
setView('map');

const filtersOpen = () => !$('filters-panel').hidden;
function openFilters() {
    closeSheet(); setView('map');
    $('filters-panel').hidden = false; $('filter-btn').setAttribute('aria-expanded', 'true'); layoutVars();
}
function closeFilters(refocus = false) {
    $('filters-panel').hidden = true; $('filter-btn').setAttribute('aria-expanded', 'false');
    if (refocus) $('filter-btn').focus();
}
$('filter-btn').onclick = () => filtersOpen() ? closeFilters(true) : openFilters();
$('filters-x').onclick = () => closeFilters(true);

// Anzahl aktiver Filter am Knopf (Sortierung zählt nicht, sie filtert nichts)
const filterCount = () => +$('fopen').checked + +$('fsun').checked + +($('ptype').value !== 'cafe');
function updateFilterBadge() {
    const n = filterCount(), b = $('filter-badge');
    b.hidden = !n; b.textContent = n;
    $('filter-btn').setAttribute('aria-label', t('filter.btn') + (n ? ', ' + t('filter.count', {n}) : ''));
}
// Kategorie-Chips steuern das (versteckte) Select, damit Handler und Zustand an einer Stelle bleiben
function syncCats() { for (const b of $('cats').children) b.setAttribute('aria-pressed', String(b.dataset.ptype === $('ptype').value)); }
$('cats').addEventListener('click', e => {
    const b = e.target.closest('[data-ptype]'); if (!b || $('ptype').value === b.dataset.ptype) return;
    $('ptype').value = b.dataset.ptype; $('ptype').dispatchEvent(new Event('change'));
});
syncCats(); updateFilterBadge();

// Esc: zuerst Dialog (macht der Browser), dann Ort-wählen, Filter, Sheet, Liste
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (isPicking()) setPicking(false);
    else if (filtersOpen()) closeFilters(true);
    else if (curId) closeSheet();
    else if (view() === 'list' && mobile.matches) setView('map', true);
});

// ---------- Ort wählen: Pin in der Kartenmitte, „Hier suchen“ und „Abbrechen“ ----------
const isPicking = () => $('app').classList.contains('picking');
function setPicking(on) {
    $('center-marker').classList.toggle('hidden-ui', !on);
    $('pick-bar').classList.toggle('hidden-ui', !on);
    $('app').classList.toggle('picking', on);
    if (on) { closeSheet(true); closeFilters(); }
    setTimeout(() => map.resize(), 50);
}
$('pick-btn').onclick = () => setPicking(true);
$('pick-cancel').onclick = () => setPicking(false);
$('confirm-place-btn').onclick = () => {
    const c = map.getCenter();
    setPicking(false);
    setTimeout(() => setPlace(c.lat, c.lng), 60); // nach dem resize, sonst fliegt die Karte zur alten Mitte
};
