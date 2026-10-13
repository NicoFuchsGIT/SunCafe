// Gemeinsame Fixtures für JS und Python (Roadmap 2.6, PRD §11): gleiche Szenen, gleiche Fassadenpunkte, gleiche Masken.
// Gegenstück: pipeline/test_points.py. Nach gewollter Änderung der Rechnung neu schreiben: UPDATE_FIXTURES=1 npm test
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {facadePoints} from '../js/shade.js';
import {horizonMask} from '../js/horizon.js';
import {polyContains, segDist} from '../js/geo.js';
import {EYE_HEIGHT} from '../js/config.js';

const FILE = new URL('fixtures/scenes.json', import.meta.url);
const r2 = v => Math.round(v * 100) / 100;
const rng = seed => () => (seed = seed * 16807 % 2147483647) / 2147483647;

function box(cx, cy, w, l, rot, h) {
    const c = Math.cos(rot), s = Math.sin(rot);
    return {h: r2(h), pts: [[-w, -l], [w, -l], [w, l], [-w, l], [-w, -l]].map(([x, y]) => [r2(cx + x * c - y * s), r2(cy + x * s + y * c)])};
}

// Eingaben: Szene 0 von Hand (Nachbarhaus im Osten, Innenhof-Wand), dann Zufallsszenen wie im Äquivalenztest
function inputs() {
    const scenes = [{eye: EYE_HEIGHT, blds: [box(0, 0, 5, 5, 0, 15), box(12.5, 0, 7.5, 5, 0, 20), box(0, -30, 20, 2, 0, 25)]}];
    const rnd = rng(20261013);
    for (let s = 0; s < 6; s++) {
        const blds = [box((rnd() - 0.5) * 10, (rnd() - 0.5) * 10, 8 + rnd() * 15, 8 + rnd() * 15, rnd() * Math.PI, 8 + rnd() * 20)];
        while (blds.length < 30) {
            const b = box((rnd() - 0.5) * 400, (rnd() - 0.5) * 400, 4 + rnd() * 25, 4 + rnd() * 25, rnd() * Math.PI, 3 + rnd() * 30);
            if (!polyContains(b.pts, 0, 0)) blds.push(b);
        }
        scenes.push({eye: s % 2 ? EYE_HEIGHT : 0, blds});
    }
    return scenes;
}

// Ausgaben: blds[0] ist das eigene Haus, Nachbarn unter 45 m wie in attachBuildings; Masken an gerundeten Punkten
function compute(sc) {
    const blds = sc.blds.map(b => ({...b, d: segDist(b.pts)})), own = blds[0], near = blds.slice(1).filter(b => b.d < 45);
    const facade = facadePoints(own, near, [own]).map(p => ({x: r2(p.x), y: r2(p.y), label: p.label, enclosed: p.enclosed}));
    const pts = [...facade, {x: 0, y: 0}, {x: 3.33, y: -60}]; // auch Punkte im eigenen Haus und abseits
    const masks = pts.map(p => {
        const skip = blds.filter(b => polyContains(b.pts, p.x, p.y));
        return Buffer.from(horizonMask({x: p.x, y: p.y, skip}, blds, sc.eye)).toString('base64');
    });
    return {facade, masks};
}

test('Fixtures: JS rechnet dieselben Fassadenpunkte und Masken wie in test/fixtures/scenes.json', () => {
    const fresh = inputs().map(sc => ({...sc, expect: compute(sc)}));
    if (process.env.UPDATE_FIXTURES) writeFileSync(FILE, JSON.stringify(fresh) + '\n');
    assert.deepEqual(fresh, JSON.parse(readFileSync(FILE, 'utf8')));
});
