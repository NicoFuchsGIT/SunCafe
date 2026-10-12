// Äquivalenztest (Roadmap 1.2, PRD F1.4): Horizontmaske gegen die Referenz inShade auf Zufallsszenen.
// Die Szenen werden wie in attachBuildings aufgebaut: eigenes Gebäude, Nachbarn, Fassadenpunkte, skip-Listen.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inShade, facadePoints} from '../js/shade.js';
import {horizonMask, maskShade, MASK_STEP} from '../js/horizon.js';
import {polyContains, segDist} from '../js/geo.js';
import {HORIZON_SECTORS} from '../js/config.js';

const DEG = Math.PI / 180;

// fester Seed, damit die Tests reproduzierbar sind (Park-Miller)
const rng = seed => () => (seed = seed * 16807 % 2147483647) / 2147483647;

function box(cx, cy, w, l, rot, h) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const pts = [[-w, -l], [w, -l], [w, l], [-w, l], [-w, -l]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
    return {h, pts, d: segDist(pts)};
}

function scene(rnd) {
    const own = box((rnd() - 0.5) * 10, (rnd() - 0.5) * 10, 8 + rnd() * 15, 8 + rnd() * 15, rnd() * Math.PI, 8 + rnd() * 20);
    const loc = [];
    while (loc.length < 60) {
        const b = box((rnd() - 0.5) * 500, (rnd() - 0.5) * 500, 4 + rnd() * 25, 4 + rnd() * 25, rnd() * Math.PI, 3 + rnd() * 30);
        if (!polyContains(b.pts, 0, 0)) loc.push(b);
    }
    const near = loc.filter(b => b.d < 45), owns = [own];
    let pts = facadePoints(own, near, owns);
    if (rnd() < 0.3) pts = [{x: (rnd() - 0.5) * 60, y: (rnd() - 0.5) * 60}]; // Terrasse aus OSM, auch mal in einem Gebäude
    for (const pt of pts) pt.skip = near.concat(owns).filter(b => polyContains(b.pts, pt.x, pt.y));
    return {occ: loc.concat(owns), pts};
}

test('Äquivalenz: Maske weicht in < 1 % der Zeitpunkte von inShade ab', t => {
    const rnd = rng(20261012);
    let n = 0, diff = 0, shade = 0, worst = 0;
    for (let s = 0; s < 150; s++) {
        const c = scene(rnd);
        for (const pt of c.pts) {
            const mask = horizonMask(pt, c.occ);
            let d = 0;
            for (let j = 0; j < 400; j++) {
                const alt = (rnd() * 75 - 5) * DEG, az = rnd() * 2 * Math.PI; // auch knapp unter dem Horizont
                const ref = inShade(c, pt, alt, az);
                if (ref !== maskShade(mask, alt, az)) d++;
                if (ref) shade++;
            }
            n += 400; diff += d; worst = Math.max(worst, d / 400);
        }
    }
    t.diagnostic(`${n} Zeitpunkte, ${(100 * shade / n).toFixed(1)} % Schatten, Abweichung ${(100 * diff / n).toFixed(2)} %, schlechtester Punkt ${(100 * worst).toFixed(1)} %`);
    assert.ok(shade > 0.2 * n && shade < 0.8 * n, 'Szenen sollen Sonne und Schatten mischen');
    assert.ok(diff / n < 0.01, `Abweichung ${(100 * diff / n).toFixed(2)} %`);
});

test('Äquivalenz: in Sektormitte nur Abweichungen innerhalb der Quantisierung', () => {
    // Auf dem Mittelstrahl eines Sektors rechnen beide Verfahren denselben Strahl; Unterschiede
    // darf es nur geben, wenn die Sonnenhöhe weniger als eine halbe Stufe neben dem Maskenwert liegt.
    const rnd = rng(42);
    for (let s = 0; s < 60; s++) {
        const c = scene(rnd);
        for (const pt of c.pts) {
            const mask = horizonMask(pt, c.occ);
            for (let k = 0; k < HORIZON_SECTORS; k++) {
                const az = k * 2 * Math.PI / HORIZON_SECTORS;
                for (let j = 0; j < 5; j++) {
                    const alt = (0.5 + rnd() * 70) * DEG;
                    if (inShade(c, pt, alt, az) === maskShade(mask, alt, az)) continue;
                    assert.ok(Math.abs(alt - mask[k] * MASK_STEP) <= MASK_STEP / 2 + 1e-9,
                        `Szene ${s}, Sektor ${k}: Sonne ${(alt / DEG).toFixed(2)}°, Maske ${(mask[k] * MASK_STEP / DEG).toFixed(2)}°`);
                }
            }
        }
    }
});
