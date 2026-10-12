// ---------- Sonnenminuten im Zeitfenster (ohne DOM) ----------
// Abtastung in festen Schritten ab dem Startzeitpunkt (PRD F3.1). Ein Schritt zählt mit seiner vollen Länge,
// wenn die Sonne über MIN_ALT steht, mindestens ein Messpunkt laut Horizontmaske Sonne hat und das Café
// nicht sicher geschlossen ist (unbekannte Öffnungszeiten zählen als offen).
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

// Sicher geschlossen? Nur wenn opening_hours einen klaren Zustand liefert
export function isClosed(c, w) {
    if (!c.oh) return false;
    try { return !c.oh.getUnknown(w) && !c.oh.getState(w); } catch(e) { return false; }
}

// Sonnenminuten eines Cafés im Fenster des Tracks; null, solange keine Masken berechnet sind
export function sunMinutes(c, track) {
    if (!c.pts || !c.pts.every(p => p.mask)) return null;
    let sum = 0;
    for (const s of track) {
        if (s.alt < MIN_ALT || !c.pts.some(p => !maskShade(p.mask, s.alt, s.az))) continue;
        if (!isClosed(c, s.w)) sum += s.min; // Öffnungszeiten erst prüfen, wenn Sonne da ist (teurer)
    }
    return sum;
}
