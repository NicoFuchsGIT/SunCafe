import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const handler = createRequire(import.meta.url)('../api/vote.js');
const good = () => ({placeId: 'node/123', deviceId: 'dev-12345678', lat: 48.2082, lng: 16.3738, t: new Date().toISOString(), vote: 'sun',
    predicted: 'shade', sunAlt: 35.2, sunAz: 180, modelVersion: '1.0', onSite: true});
const call = async (body, {method = 'POST', headers = {'x-real-ip': '1.2.3.4'}} = {}) => {
    const res = {headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; },
        json(b) { this.body = b; return this; }, end() { return this; }};
    await handler({method, body, headers}, res);
    return res;
};
// Minimaler Upstash-Ersatz im Speicher: INCR, EXPIRE, SET (NX), RPUSH
const fakeKv = t => {
    const kv = new Map(), lists = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        const run = ([cmd, k, v, ...rest]) => {
            let result = 'OK';
            if (cmd === 'INCR') { kv.set(k, (kv.get(k) || 0) + 1); result = kv.get(k); }
            else if (cmd === 'SET') { if (rest.includes('NX') && kv.has(k)) result = null; else kv.set(k, v); }
            else if (cmd === 'RPUSH') { lists.push(v); result = lists.length; }
            return {result};
        };
        const body = JSON.parse(init.body);
        return {ok: true, json: async () => url.endsWith('/pipeline') ? body.map(run) : run(body)};
    });
    return {kv, lists};
};
const env = () => { process.env.UPSTASH_REDIS_REST_URL = 'https://kv.test'; process.env.UPSTASH_REDIS_REST_TOKEN = 't'; process.env.VOTE_SALT = 'salz'; };

test.beforeEach(env);

test('nur POST erlaubt', async t => {
    t.mock.method(globalThis, 'fetch', async () => assert.fail('kein Storage-Zugriff'));
    assert.equal((await call(good(), {method: 'GET'})).code, 405);
});

test('ungültige Eingaben werden vor dem Storage abgelehnt', async t => {
    t.mock.method(globalThis, 'fetch', async () => assert.fail('kein Storage-Zugriff'));
    const bad = [null, 'x', {...good(), vote: 'rain'}, {...good(), placeId: 'node/1;DROP'}, {...good(), deviceId: 'a'}, {...good(), lat: 91},
        {...good(), sunAlt: '35'}, {...good(), t: '2020-01-01T00:00:00Z'}, {...good(), predicted: 'x'}, {...good(), modelVersion: 'x'.repeat(40)}];
    for (const b of bad) assert.equal((await call(b)).code, 400, JSON.stringify(b));
});

test('gültiger Vote wird ohne Roh-Geräte-ID und ohne IP gespeichert', async t => {
    const {lists} = fakeKv(t);
    assert.equal((await call(good())).code, 204);
    const saved = JSON.parse(lists[0]);
    assert.equal(saved.vote, 'sun'); assert.equal(saved.predicted, 'shade'); assert.equal(saved.modelVersion, '1.0'); assert.equal(saved.onSite, true);
    assert.doesNotMatch(lists[0], /dev-12345678|1\.2\.3\.4/);
});

test('zweiter Vote für denselben Ort und dasselbe Gerät → 429 mit Retry-After', async t => {
    const {lists} = fakeKv(t);
    assert.equal((await call(good())).code, 204);
    const r = await call(good());
    assert.equal(r.code, 429); assert.equal(r.headers['Retry-After'], '1800');
    assert.equal(lists.length, 1);
    assert.equal((await call({...good(), placeId: 'node/124'})).code, 204); // anderer Ort geht
});

test('Geräte-Limit pro Stunde', async t => {
    fakeKv(t);
    for (let i = 0; i < 20; i++) assert.equal((await call({...good(), placeId: 'node/' + (1000 + i)}, {headers: {'x-real-ip': '9.9.' + i}})).code, 204);
    assert.equal((await call({...good(), placeId: 'node/2000'}, {headers: {'x-real-ip': '8.8.8.8'}})).code, 429);
});

test('IP-Limit gilt über Geräte hinweg', async t => {
    fakeKv(t);
    for (let i = 0; i < 60; i++) assert.equal((await call({...good(), deviceId: 'device-' + (10000 + i)})).code, 204);
    assert.equal((await call({...good(), deviceId: 'device-99999'})).code, 429);
});

test('ohne Salt oder Storage lehnt die API ab (fail closed)', async t => {
    fakeKv(t);
    delete process.env.VOTE_SALT;
    assert.equal((await call(good())).code, 503);
    env(); delete process.env.UPSTASH_REDIS_REST_URL;
    assert.equal((await call(good())).code, 503);
});

test('Storage-Fehler → 503', async t => {
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('down'); });
    assert.equal((await call(good())).code, 503);
});

test('unbekannte Felder werden nicht gespeichert, Koordinaten gerundet', async t => {
    const {lists} = fakeKv(t);
    assert.equal((await call({...good(), lat: 48.208212345, comment: 'Freitext', userLat: 48.1, email: 'a@b.at'})).code, 204);
    const saved = JSON.parse(lists[0]);
    assert.equal(saved.lat, 48.20821);
    assert.deepEqual(Object.keys(saved).sort(), ['dev', 'lat', 'lng', 'modelVersion', 'onSite', 'placeId', 'predicted', 'sunAlt', 'sunAz', 't', 'vote']);
    assert.doesNotMatch(lists[0], /Freitext|a@b\.at/);
});

test('Rate-Limit-Schlüssel enthalten nur Hashes und laufen ab', async t => {
    const sent = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => { const b = JSON.parse(init.body); const cmds = url.endsWith('/pipeline') ? b : [b]; sent.push(...cmds); return {ok: true, json: async () => url.endsWith('/pipeline') ? cmds.map(() => ({result: 1})) : {result: init.body.includes('"SET"') ? 'OK' : 1}}; });
    assert.equal((await call(good())).code, 204);
    const keys = sent.map(c => c[1]).filter(k => k !== 'votes');
    assert.equal(keys.length >= 3, true);
    for (const k of keys) assert.doesNotMatch(k, /dev-12345678|1\.2\.3\.4/);
    assert.ok(sent.some(c => c[0] === 'EXPIRE' || c.includes('EX')), 'TTL gesetzt');
});

test('onSite ist nur true, wenn es genau true ist', async t => {
    const {lists} = fakeKv(t);
    await call({...good(), onSite: 'true'});
    assert.equal(JSON.parse(lists[0]).onSite, false);
});
