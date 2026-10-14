import {test} from 'node:test';
import assert from 'node:assert/strict';
import {predicted, buildVote, checkOnSite, sendVote} from '../js/vote.js';

const cafe = (o = {}) => ({id: 'node/42', lat: 48.2082, lng: 16.3738, state: 'sun', partial: false, ...o});

test('predicted: Zustand wird auf die API-Werte abgebildet', () => {
    assert.equal(predicted(cafe()), 'sun');
    assert.equal(predicted(cafe({partial: true})), 'part');
    assert.equal(predicted(cafe({state: 'shade'})), 'shade');
    assert.equal(predicted(cafe({state: 'night'})), 'night');
    assert.equal(predicted(cafe({state: 'pending'})), null);
});

test('buildVote: Grad, Kompasswinkel 0–360, keine Nutzlast ohne Rechnung', () => {
    const v = buildVote(cafe(), {alt: Math.PI / 6, az: -Math.PI / 2, device: 'dev-12345678'});
    assert.equal(Math.round(v.sunAlt), 30);
    assert.equal(Math.round(v.sunAz), 270);
    assert.equal(v.predicted, 'sun'); assert.equal(v.onSite, false); assert.ok(v.modelVersion);
    assert.equal(buildVote(cafe({state: 'pending'}), {alt: 0, az: 0}), null);
});

test('buildVote passt zur Validierung der API', async () => {
    const handler = (await import('node:module')).createRequire(import.meta.url)('../api/vote.js');
    const res = {setHeader() {}, status(c) { this.code = c; return this; }, json() { return this; }, end() { return this; }};
    const v = {...buildVote(cafe(), {alt: 0.5, az: 1, device: 'dev-12345678'}), vote: 'sun'};
    delete process.env.VOTE_SALT; // ohne Speicher: 503 heißt, die Validierung hat bestanden (400 wäre ein Formfehler)
    await handler({method: 'POST', body: v, headers: {}}, res);
    assert.equal(res.code, 503);
});

test('checkOnSite: ≤ 150 m ja, weiter weg oder Fehler nein', async () => {
    const at = (dlat) => cb => cb.ok({coords: {latitude: 48.2082 + dlat, longitude: 16.3738}});
    assert.equal(await checkOnSite(cafe(), at(0.001)), true);   // ~111 m
    assert.equal(await checkOnSite(cafe(), at(0.002)), false);  // ~222 m
    assert.equal(await checkOnSite(cafe(), cb => cb.fail()), false);
});

test('sendVote: ok, 429, Fehler', async () => {
    const f = (status, ok = status < 300) => async () => ({ok, status});
    assert.equal(await sendVote({}, 'sun', f(204)), 'ok');
    assert.equal(await sendVote({}, 'sun', f(429)), 'limit');
    assert.equal(await sendVote({}, 'sun', f(503)), 'error');
    assert.equal(await sendVote({}, 'sun', async () => { throw new Error('x'); }), 'error');
});
