// Beide Sprachen müssen dieselben Schlüssel und dieselben Platzhalter haben.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DICT} from '../js/i18n.js';

const keys = l => Object.keys(DICT[l]).sort();
const holders = s => (s.match(/\{\w+\}/g) || []).sort().join();

test('DE und EN haben dieselben Schlüssel', () => {
    assert.deepEqual(keys('en'), keys('de'));
});

test('Keine leeren Übersetzungen', () => {
    for (const l of Object.keys(DICT)) for (const [k, v] of Object.entries(DICT[l])) assert.ok(v.trim(), `${l}: ${k} ist leer`);
});

test('Platzhalter stimmen in beiden Sprachen überein', () => {
    for (const k of keys('de')) assert.equal(holders(DICT.en[k]), holders(DICT.de[k]), `Platzhalter bei ${k}`);
});

test('Jeder in index.html verwendete Schlüssel existiert', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const used = [...html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map(m => m[1]);
    for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const p of m[1].split(';')) used.push(p.split(':')[1]);
    assert.ok(used.length > 20);
    for (const k of used) assert.ok(k in DICT.de, `Schlüssel fehlt: ${k}`);
});
