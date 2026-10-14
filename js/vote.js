// ---------- 1-Tap-Votes: Nutzlast und Senden (PRD F4.1–F4.4), ohne DOM-Pflicht ----------
import {MODEL_VERSION, VOTE_ONSITE_RADIUS} from './config.js';
import {distM} from './geo.js';

const DEV_KEY = 'suncafe.device', SENT_KEY = 'suncafe.voted';
const PLACE_COOLDOWN_MS = 30 * 60000; // wie im Rate-Limit der API

const store = () => { try { return globalThis.localStorage; } catch (e) { return null; } };
const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

// Zufällige Geräte-ID, nur zur Deduplizierung (F4.3)
export function deviceId() {
    const s = store();
    let id = s && s.getItem(DEV_KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) { id = rnd(); try { s && s.setItem(DEV_KEY, id); } catch (e) { /* ohne Speicher gilt die ID nur für diese Sitzung */ } }
    return id;
}

// Café schon kürzlich bewertet? Dient nur der Anzeige, die Sperre erzwingt die API.
export function votedRecently(placeId, now = Date.now()) {
    try { const at = JSON.parse(store().getItem(SENT_KEY) || '{}')[placeId]; return !!at && now - at < PLACE_COOLDOWN_MS; } catch (e) { return false; }
}
export function markVoted(placeId, now = Date.now()) {
    try {
        const all = JSON.parse(store().getItem(SENT_KEY) || '{}');
        for (const k of Object.keys(all)) if (now - all[k] >= PLACE_COOLDOWN_MS) delete all[k];
        all[placeId] = now; store().setItem(SENT_KEY, JSON.stringify(all));
    } catch (e) { /* nur Komfort */ }
}

// Modellvorhersage für die Speicherung; null, wenn noch nichts berechnet ist (dann kein Vote)
export const predicted = c => c.state === 'night' ? 'night' : c.state === 'sun' ? (c.partial ? 'part' : 'sun') : c.state === 'shade' ? 'shade' : null;

// Nur „Jetzt“ lässt sich bewerten: die API akzeptiert Zeitstempel nur nahe an der Serverzeit
export function buildVote(c, {now = new Date(), alt, az, onSite = false, device = deviceId()}) {
    const p = predicted(c);
    if (!p || !/^(node|way|relation)\/\d+$/.test(c.osmId)) return null;
    return {placeId: c.osmId, deviceId: device, lat: c.lat, lng: c.lng, t: now.toISOString(), vote: null, predicted: p,
        sunAlt: alt * 180 / Math.PI, sunAz: ((az * 180 / Math.PI) % 360 + 360) % 360, modelVersion: MODEL_VERSION, onSite};
}

// Standort prüfen (F4.4): true nur, wenn er bestimmt werden konnte und ≤ Radius vom Café liegt
export function checkOnSite(c, getPos = cb => globalThis.navigator?.geolocation ? navigator.geolocation.getCurrentPosition(cb.ok, cb.fail, {enableHighAccuracy: true, timeout: 8000, maximumAge: 30000}) : cb.fail()) {
    return new Promise(resolve => {
        getPos({ok: p => resolve(distM(c.lat, c.lng, p.coords.latitude, p.coords.longitude) <= VOTE_ONSITE_RADIUS), fail: () => resolve(false)});
    });
}

// Ergebnis: 'ok' | 'limit' (429, schon bewertet) | 'error'
export async function sendVote(payload, vote, fetchFn = fetch) {
    try {
        const r = await fetchFn('/api/vote', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({...payload, vote})});
        return r.ok ? 'ok' : r.status === 429 ? 'limit' : 'error';
    } catch (e) { return 'error'; }
}
