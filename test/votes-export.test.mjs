import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const handler = createRequire(import.meta.url)('../api/votes-export.js');
const call = async (headers, method = 'GET') => {
    const res = {headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; },
        json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }};
    await handler({method, headers}, res);
    return res;
};
const env = (t, list) => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://kv.test'; process.env.UPSTASH_REDIS_REST_TOKEN = 'tok'; process.env.VOTES_EXPORT_TOKEN = 'secret';
    t.mock.method(globalThis, 'fetch', async () => ({ok: true, status: 200, json: async () => ({result: list})}));
};
const v = (t, o = {}) => JSON.stringify({t, placeId: 'node/1', lat: 48.2, lng: 16.3, vote: 'sun', predicted: 'shade', sunAlt: 30, sunAz: 180, modelVersion: '1.0', onSite: true, dev: 'abc', ...o});

test('ohne Token-Konfiguration 503, falsche Methode 405, falsches Token 401', async t => {
    env(t, []); delete process.env.VOTES_EXPORT_TOKEN;
    assert.equal((await call({authorization: 'Bearer secret'})).code, 503);
    process.env.VOTES_EXPORT_TOKEN = 'secret';
    assert.equal((await call({}, 'POST')).code, 405);
    assert.equal((await call({})).code, 401);
    assert.equal((await call({authorization: 'Bearer nope'})).code, 401);
    assert.equal((await call({authorization: 'secret'})).code, 401);
});

test('liefert CSV mit Kopfzeile, nach Zeit sortiert, defekte Einträge übersprungen', async t => {
    env(t, [v('2027-05-01T12:00:00.000Z', {placeId: 'node/2'}), 'kaputt', v('2027-05-01T10:00:00.000Z')]);
    const r = await call({authorization: 'Bearer secret'});
    assert.equal(r.code, 200);
    assert.match(r.headers['Content-Type'], /text\/csv/);
    const lines = r.body.trim().split('\n');
    assert.equal(lines[0], 't,placeId,lat,lng,vote,predicted,sunAlt,sunAz,modelVersion,onSite,dev');
    assert.equal(lines.length, 3);
    assert.match(lines[1], /^2027-05-01T10:00:00.000Z,node\/1,48.2,16.3,sun,shade,30,180,1.0,true,abc$/);
    assert.match(lines[2], /node\/2/);
});

test('Werte mit Komma oder Anführungszeichen werden gequotet', async t => {
    env(t, [v('2027-05-01T10:00:00.000Z', {modelVersion: 'a,"b"'})]);
    assert.match((await call({authorization: 'Bearer secret'})).body, /"a,""b"""/);
});
