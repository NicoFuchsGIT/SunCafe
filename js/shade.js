// Schattenrechnung ohne DOM. Koordinaten in Metern relativ zum Café (x nach Osten, y nach Norden),
// Gebäude als {h, pts:[[x,y], ...], d} mit geschlossenem Ring (letzter Punkt = erster Punkt).
export const TERRACE_OFFSET = 4, SHADOW_REACH = 300;

export const polyContains = (pts, x, y) => { let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
        if ((pts[i][1] > y) !== (pts[j][1] > y) && x < (pts[j][0]-pts[i][0]) * (y-pts[i][1]) / (pts[j][1]-pts[i][1]) + pts[i][0]) c = !c;
    return c; };

const SIDES = ['Nord','Nordost','Ost','Südost','Süd','Südwest','West','Nordwest'];
export const sideName = (nx, ny) => 'Seite ' + SIDES[(Math.round(Math.atan2(nx, ny) / (Math.PI / 4)) + 8) % 8];

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

export function facadePoints(own, near, owns) {
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

export function inShade(c, pt, alt, az) { // az: Kompass, Richtung zur Sonne; pt: Terrassenpunkt relativ zum Café
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
