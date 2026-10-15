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
        {lat: '48.2', lng: '181', ptype: 'cafe'}, {lat: '48.2', lng: '16.37', ptype: 'node(1)'}, {lat: '48.2', lng: '', ptype: 'cafe'},
        {lat: '48.2', lng: '16.37', ptype: ','}, {lat: '48.2', lng: '16.37', ptype: 'cafe,bar;x'}, {lat: '48.2', lng: '16.37', ptype: 'cafe,pizza'}, {lat: '48.2', lng: '16.37'}])
        assert.equal((await call(q)).code, 400, JSON.stringify(q));
});

test('Proxy baut die Café-Abfrage selbst, gerundet auf 3 Stellen', async t => {
    let body;
    t.mock.method(globalThis, 'fetch', async (url, init) => { body = decodeURIComponent(init.body.slice(5)); return {ok: true, text: async () => '{"elements":[]}'}; });
    const res = await call({lat: '48.20821', lng: '16.37384', ptype: 'bar'});
    assert.equal(res.code, 200);
    assert.equal(res.body, '{"elements":[]}');
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.match(body, /^\[out:json\]/);
    assert.match(body, /around:1000,48\.208,16\.374\)/);
    assert.match(body, /"amenity"="pub"/);
    assert.doesNotMatch(body, /"amenity"="restaurant"/);
    assert.doesNotMatch(body, /"amenity"="cafe"/, 'nur Bars: keine Cafés in der Abfrage');
});

test('Proxy: mehrere Arten ergeben eine gemeinsame Abfrage', async t => {
    let body;
    t.mock.method(globalThis, 'fetch', async (url, init) => { body = decodeURIComponent(init.body.slice(5)); return {ok: true, text: async () => '{"elements":[]}'}; });
    assert.equal((await call({lat: '48.2', lng: '16.37', ptype: 'bar,rest'})).code, 200);
    assert.match(body, /"amenity"="pub"/);
    assert.match(body, /"amenity"="restaurant"/);
    assert.doesNotMatch(body, /"shop"="bakery"/);
});

test('Proxy cached keine Überlast-Antworten (remark, kaputtes JSON) und fragt den nächsten Server', async t => {
    const answers = ['{"elements":[],"remark":"runtime error: Query timed out"}', '<html>busy</html>', '{"elements":[{"type":"node","id":1}]}'];
    let n = 0;
    t.mock.method(globalThis, 'fetch', async () => ({ok: true, text: async () => answers[n++]}));
    const res = await call({lat: '48.2', lng: '16.37', ptype: 'cafe'});
    assert.equal(res.code, 200);
    assert.equal(n, 3);
    assert.match(res.body, /"id":1/);
    assert.match(res.headers['Cache-Control'], /s-maxage/);
});

test('Proxy liefert 502, wenn nur Überlast-Antworten kommen', async t => {
    t.mock.method(globalThis, 'fetch', async () => ({ok: true, text: async () => '{"elements":[],"remark":"timeout"}'}));
    assert.equal((await call({lat: '48.2', lng: '16.37', ptype: 'cafe'})).code, 502);
});
