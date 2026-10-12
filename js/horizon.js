// ---------- Horizontmaske pro Messpunkt (ohne DOM) ----------
// Für jeden Azimut-Sektor der größte Höhenwinkel, unter dem Gebäude den Himmel verdecken (PRD F1.1).
// Die Maske ist zeitunabhängig: einmal rechnen, danach kostet jeder Zeitpunkt nur einen Lookup (F1.2).
// Gleiche Geometrie wie inShade: Gebäude-Kanten bis SHADOW_REACH, Punkte im Gebäude selbst (pt.skip) zählen nicht.
import {SHADOW_REACH, HORIZON_SECTORS as N} from './config.js';

const SECTOR = 2 * Math.PI / N;            // Sektor k ist um den Azimut k·SECTOR zentriert
export const MASK_STEP = Math.PI / 2 / 255; // Höhenwinkel als uint8: 0..255 ≙ 0..90° (≈ 0,35° pro Stufe)
const MIN_SUN = 0.5 * Math.PI / 180;        // wie inShade: tiefere Sonne zählt als 0,5°

export const sectorOf = az => ((Math.round(az / SECTOR) % N) + N) % N; // az: Kompass in Radiant, beliebig oft umlaufend

// pt: Messpunkt relativ zum Café; blds: Gebäude {h, pts, d}; eye: Augenhöhe in m über Grund
export function horizonMask(pt, blds, eye = 0) {
    const mask = new Uint8Array(N), po = Math.hypot(pt.x, pt.y);
    for (const b of blds) {
        const dh = b.h - eye;
        if (dh <= 0 || b.d - po > SHADOW_REACH || (pt.skip && pt.skip.includes(b))) continue;
        const p = b.pts;
        for (let i = 0; i < p.length - 1; i++) {
            const ax = p[i][0] - pt.x, ay = p[i][1] - pt.y, ex = p[i+1][0] - p[i][0], ey = p[i+1][1] - p[i][1];
            // nur die Sektoren prüfen, deren Mittelstrahl zwischen den beiden Ecken liegt
            const a0 = Math.atan2(ax, ay);
            let span = Math.atan2(ax + ex, ay + ey) - a0;
            if (span > Math.PI) span -= 2 * Math.PI; else if (span < -Math.PI) span += 2 * Math.PI;
            const k0 = Math.ceil((Math.min(a0, a0 + span) - 1e-9) / SECTOR), k1 = Math.floor((Math.max(a0, a0 + span) + 1e-9) / SECTOR);
            for (let k = k0; k <= k1; k++) {
                const dx = Math.sin(k * SECTOR), dy = Math.cos(k * SECTOR), den = dx * ey - dy * ex;
                if (Math.abs(den) < 1e-9) continue;
                const t = (ax * ey - ay * ex) / den, u = (ax * dy - ay * dx) / den;
                if (u < 0 || u > 1 || t <= 0.05 || t > SHADOW_REACH) continue;
                const q = Math.round(Math.atan2(dh, t) / MASK_STEP), s = ((k % N) + N) % N;
                if (q > mask[s]) mask[s] = q;
            }
        }
    }
    return mask;
}

// Schatten laut Maske: Sonne steht nicht über der Verdeckung in ihrer Richtung
export const maskShade = (mask, alt, az) => Math.max(alt, MIN_SUN) <= mask[sectorOf(az)] * MASK_STEP;

// Masken für alle Messpunkte eines Cafés (nach attachBuildings)
export function attachMasks(c, eye = 0) {
    for (const pt of c.pts) pt.mask = horizonMask(pt, c.occ, eye);
}
