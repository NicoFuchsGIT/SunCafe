import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const handler = createRequire(import.meta.url)('../api/overpass.js');
const call = async query => {
    const res = {headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; },
        json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }};
    await handler({query}, res);
    return res;
};

test('Proxy lehnt fremde Abfragen und ungültige Parameter ab', async t => {
    t.mock.method(globalThis, 'fetch', async () => assert.fail('Overpass darf nicht gefragt werden'));
    for (const q of [{data: '[out:json];node(1);out;'}, {lat: 'x', lng: '16.37', ptype: 'cafe'}, {lat: '91', lng: '16.37', ptype: 'cafe'},
        {lat: '48.2', lng: '181', ptype: 'cafe'}, {lat: '48.2', lng: '16.37', ptype: 'node(1)'}, {lat: '48.2', lng: '', ptype: 'cafe'}])
        assert.equal((await call(q)).code, 400, JSON.stringify(q));
});

test('Proxy baut die Café-Abfrage selbst, gerundet auf 3 Stellen', async t => {
    let body;
    t.mock.method(globalThis, 'fetch', async (url, init) => { body = decodeURIComponent(init.body.slice(5)); return {ok: true, text: async () => '{"elements":[]}'}; });
    const res = await call({lat: '48.20821', lng: '16.37384', ptype: 'bar'});
    assert.equal(res.code, 200);
    assert.equal(res.body, '{"elements":[]}');
    assert.match(body, /^\[out:json\]/);
    assert.match(body, /around:1000,48\.208,16\.374\)/);
    assert.match(body, /"amenity"="pub"/);
    assert.doesNotMatch(body, /"amenity"="restaurant"/);
});
