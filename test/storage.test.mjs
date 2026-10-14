import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const storage = createRequire(import.meta.url)('../api/_lib/storage.js');
const setEnv = () => { process.env.UPSTASH_REDIS_REST_URL = 'https://kv.test'; process.env.UPSTASH_REDIS_REST_TOKEN = 'tok'; };
const clearEnv = () => { for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) delete process.env[k]; };

test('ohne Konfiguration nicht verfügbar und Aufrufe schlagen fehl', async () => {
    clearEnv();
    assert.equal(storage.available(), false);
    await assert.rejects(storage.get('a'), /not configured/);
});

test('KV_REST_API_* der Vercel-Integration wird ebenfalls erkannt', () => {
    clearEnv();
    process.env.KV_REST_API_URL = 'https://kv.test'; process.env.KV_REST_API_TOKEN = 't';
    assert.equal(storage.available(), true);
    clearEnv();
});

test('Befehle gehen als JSON-Array mit Bearer-Token an Upstash', async t => {
    setEnv();
    let req;
    t.mock.method(globalThis, 'fetch', async (url, init) => { req = {url, init}; return {ok: true, json: async () => ({result: 'OK'})}; });
    assert.equal(await storage.set('k', {a: 1}, {ttl: 60, nx: true}), true);
    assert.equal(req.url, 'https://kv.test');
    assert.equal(req.init.headers.Authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(req.init.body), ['SET', 'k', '{"a":1}', 'EX', '60', 'NX']);
    clearEnv();
});

test('set mit nx liefert false, wenn der Schlüssel schon existiert', async t => {
    setEnv();
    t.mock.method(globalThis, 'fetch', async () => ({ok: true, json: async () => ({result: null})}));
    assert.equal(await storage.set('k', 'v', {nx: true}), false);
    clearEnv();
});

test('incrWithTtl setzt die Lebensdauer nur beim ersten Aufruf', async t => {
    setEnv();
    const sent = [];
    let n = 0;
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        const cmd = JSON.parse(init.body); sent.push(cmd[0]);
        return {ok: true, json: async () => ({result: cmd[0] === 'INCR' ? ++n : 1})};
    });
    assert.equal(await storage.incrWithTtl('c', 30), 1);
    assert.equal(await storage.incrWithTtl('c', 30), 2);
    assert.deepEqual(sent, ['INCR', 'EXPIRE', 'INCR']);
    clearEnv();
});

test('Fehler von Upstash werden geworfen', async t => {
    setEnv();
    t.mock.method(globalThis, 'fetch', async () => ({ok: false, status: 401, json: async () => ({error: 'WRONGPASS'})}));
    await assert.rejects(storage.get('k'), /WRONGPASS/);
    clearEnv();
});
