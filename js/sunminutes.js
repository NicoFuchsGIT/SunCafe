// ---------- Sonnenminuten im Zeitfenster (ohne DOM) ----------
// Abtastung in festen Schritten ab dem Startzeitpunkt (PRD F3.1). Ein Schritt zählt mit seiner vollen Länge,
// wenn die Sonne über MIN_ALT steht, mindestens ein Messpunkt laut Horizontmaske Sonne hat und das Café
// nicht sicher geschlossen ist (fehlende oder unklare Öffnungszeiten zählen als offen).
import {MIN_ALT, SUN_WINDOW_MIN, SUN_STEP_MIN} from './config.js';
import {maskShade} from './horizon.js';
import {wall} from './hours.js';

// Sonnenstand pro Schritt, einmal für alle Cafés. getPos(d) liefert {altitude, azimuth} wie SunCalc.getPosition
// (Azimut ab Süden); hier umgerechnet auf Kompass wie in ui.js. w ist die Ortszeit für die Öffnungszeiten.
export function sunTrack(start, getPos, tz, win = SUN_WINDOW_MIN, step = SUN_STEP_MIN) {
    const track = [];
    for (let m = 0; m < win; m += step) {
        const d = new Date(start.getTime() + m * 60000), p = getPos(d);
        track.push({d, w: wall(d, tz), alt: p.altitude, az: p.azimuth + Math.PI, min: Math.min(step, win - m)});
    }
    return track;
}

// Offene Zeiträume im Fenster als [von, bis) in Ortszeit, einmal pro Café statt getState pro Schritt.
// null heißt: keine Einschränkung (Öffnungszeiten fehlen oder sind unlesbar). Zeiträume mit unklarem
// Zustand liefert opening_hours mit, sie zählen also als offen; alles außerhalb ist sicher geschlossen.
export function openSpans(c, track) {
    if (!c.oh || !track.length) return null;
    const last = track[track.length - 1];
    try { return c.oh.getOpenIntervals(track[0].w, new Date(last.w.getTime() + last.min * 60000)).map(([a, b]) => [a.getTime(), b.getTime()]); }
    catch(e) { return null; }
}
const isOpen = (spans, w) => !spans || spans.some(([a, b]) => a <= w.getTime() && w.getTime() < b);

// Sonnenminuten eines Cafés im Fenster des Tracks; null, solange keine Masken berechnet sind
export function sunMinutes(c, track) {
    if (!c.pts || !c.pts.every(p => p.mask)) return null;
    let sum = 0, spans;
    for (const s of track) {
        if (s.alt < MIN_ALT || !c.pts.some(p => !maskShade(p.mask, s.alt, s.az))) continue;
        if (spans === undefined) spans = openSpans(c, track); // Öffnungszeiten erst holen, wenn Sonne da ist
        if (isOpen(spans, s.w)) sum += s.min;
    }
    return sum;
}

// Zustand pro Schritt für die Sonnen-Timeline im Café-Sheet: 'night' (Sonne unter MIN_ALT), 'closed' (sicher
// geschlossen), sonst 'sun' oder 'shade' wie bei sunMinutes; null, solange keine Masken berechnet sind
export function sunSlots(c, track) {
    if (!c.pts || !c.pts.every(p => p.mask)) return null;
    const spans = openSpans(c, track);
    return track.map(s => ({d: s.d, w: s.w, min: s.min, s: s.alt < MIN_ALT ? 'night' : !isOpen(spans, s.w) ? 'closed'
        : c.pts.some(p => !maskShade(p.mask, s.alt, s.az)) ? 'sun' : 'shade'}));
}

// „Beste Stunde“: Fenster von len Minuten ab dem ersten Schritt, der nicht vor from beginnt, mit den meisten
// Sonnenminuten (bei Gleichstand das früheste), auf den ersten und letzten Sonnenschritt gekürzt.
// Liefert {start, end, min} mit Schrittindizes [start, end) oder null, wenn ab from keine Sonne mehr kommt.
export function bestWindow(slots, from, len = 60) {
    let best = null;
    for (let i = 0; i < slots.length; i++) {
        if (slots[i].d < from) continue;
        let sum = 0, dur = 0, first = -1, last = -1;
        for (let j = i; j < slots.length && dur < len; j++) {
            dur += slots[j].min;
            if (slots[j].s === 'sun') { sum += slots[j].min; if (first < 0) first = j; last = j; }
        }
        if (sum > (best ? best.min : 0)) best = {start: first, end: last + 1, min: sum};
    }
    return best;
}
