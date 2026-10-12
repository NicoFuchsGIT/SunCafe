// ---------- Geometrie (ohne DOM) ----------
// Lokale Ebene in Metern: x nach Osten, y nach Norden
export const M_PER_DEG = 111320;
export const kxAt = lat => M_PER_DEG * Math.cos(lat * Math.PI / 180);
// Abstand in Metern, Maßstab in x-Richtung am Bezugspunkt (lat0, lng0)
export const distM = (lat0, lng0, lat, lng) => Math.hypot((lng - lng0) * kxAt(lat0), (lat - lat0) * M_PER_DEG);

export const polyContains = (pts, x, y) => { let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
        if ((pts[i][1] > y) !== (pts[j][1] > y) && x < (pts[j][0]-pts[i][0]) * (y-pts[i][1]) / (pts[j][1]-pts[i][1]) + pts[i][0]) c = !c;
    return c; };

export function segDist(p) { // kleinster Abstand des Café-Punkts (0,0) zum Gebäuderand
    let m = Infinity;
    for (let i = 0; i < p.length - 1; i++) {
        const ex = p[i+1][0] - p[i][0], ey = p[i+1][1] - p[i][1], l2 = ex * ex + ey * ey;
        let s = l2 ? -(p[i][0] * ex + p[i][1] * ey) / l2 : 0; s = Math.max(0, Math.min(1, s));
        m = Math.min(m, Math.hypot(p[i][0] + s * ex, p[i][1] + s * ey));
    }
    return m;
}

export function rayHits(x, y, dx, dy, maxD, blds) {
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

const SIDES = ['Nord','Nordost','Ost','Südost','Süd','Südwest','West','Nordwest'];
export const sideName = (nx, ny) => 'Seite ' + SIDES[(Math.round(Math.atan2(nx, ny) / (Math.PI / 4)) + 8) % 8];
