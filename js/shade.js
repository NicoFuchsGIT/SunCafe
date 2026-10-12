// ---------- Terrassenposition und Schattenrechnung (ohne DOM) ----------
import {TERRACE_OFFSET, SHADOW_REACH, DEFAULT_HEIGHT, LEVEL_HEIGHT} from './config.js';
import {M_PER_DEG, kxAt, polyContains, segDist, rayHits, sideName} from './geo.js';

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

export function terracePoints(c, kx, ky) {
    if (c.terr.length) return c.terr.map(t => ({x: (t.lng - c.lng) * kx, y: (t.lat - c.lat) * ky, label: 'Terrasse (OSM)', kind: 'osm'}));
    if (c.owns.length) { const f = facadePoints(c.owns[0], c.near, c.owns); if (f.length) return f; }
    return [{x: 0, y: 0, label: 'Position laut OSM', kind: 'point'}];
}

export function attachBuildings(list, data) {
    const bl = data.elements.filter(e => e.type === 'way' && e.tags && e.tags.building && e.geometry).map(e => {
        const t = e.tags;
        const h = t.height ? (parseFloat(String(t.height).replace('m','').trim()) || DEFAULT_HEIGHT)
            : (parseFloat(t['building:levels']) * LEVEL_HEIGHT || DEFAULT_HEIGHT);
        return {h, g:e.geometry};
    });
    for (const c of list) {
        const kx = kxAt(c.lat), ky = M_PER_DEG;
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
