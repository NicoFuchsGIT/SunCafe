import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const handler = createRequire(import.meta.url)('../api/votes-export.js');
const call = async (headers, method = 'GET', query) => {
    const res = {headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; },
        json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }};
    await handler({method, headers, query}, res);
    return res;
};
const env = (t, list) => {
    env.sent = [];
    process.env.UPSTASH_REDIS_REST_URL = 'https://kv.test'; process.env.UPSTASH_REDIS_REST_TOKEN = 'tok'; process.env.VOTES_EXPORT_TOKEN = 'secret';
    t.mock.method(globalThis, 'fetch', async (url, init) => { env.sent.push(JSON.parse(init.body)); return {ok: true, status: 200, json: async () => ({result: list})}; });
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

test('Export ist seitenweise: offset/limit gehen an LRANGE, volle Seite meldet X-Next-Offset', async t => {
    env(t, [v('2026-01-01T10:00:00Z'), v('2026-01-01T11:00:00Z')]);
    let r = await call({authorization: 'Bearer secret'}, 'GET', {offset: '4', limit: '2'});
    assert.deepEqual(env.sent[0], ['LRANGE', 'votes', '4', '5']);
    assert.equal(r.headers['X-Next-Offset'], '6');
    r = await call({authorization: 'Bearer secret'}, 'GET', {offset: '0', limit: '5'});
    assert.equal(r.headers['X-Next-Offset'], undefined, 'letzte Seite');
    r = await call({authorization: 'Bearer secret'}, 'GET', {offset: '-3', limit: 'abc'});
    assert.deepEqual(env.sent.at(-1), ['LRANGE', 'votes', '0', '9999'], 'ungültige Werte → Standard');
    r = await call({authorization: 'Bearer secret'}, 'GET', {limit: '999999'});
    assert.deepEqual(env.sent.at(-1), ['LRANGE', 'votes', '0', '9999'], 'Obergrenze');
});
