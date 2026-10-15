import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isApple, googleUrl, appleUrl} from '../js/route.js';

test('Route: Google-Link mit Koordinaten und zu Fuß', () => {
    const u = new URL(googleUrl(48.2082, 16.3738));
    assert.equal(u.searchParams.get('destination'), '48.2082,16.3738');
    assert.equal(u.searchParams.get('travelmode'), 'walking');
});
test('Route: Apple-Link mit Koordinaten und zu Fuß', () => {
    const u = new URL(appleUrl(48.2082, 16.3738));
    assert.equal(u.searchParams.get('daddr'), '48.2082,16.3738');
    assert.equal(u.searchParams.get('dirflg'), 'w');
});
test('Route: iPhone und iPad erkannt, Android und Desktop nicht', () => {
    assert.equal(isApple('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), true);
    assert.equal(isApple('Mozilla/5.0 (Macintosh)', 'MacIntel', 5), true); // iPadOS
    assert.equal(isApple('Mozilla/5.0 (Macintosh)', 'MacIntel', 0), false);
    assert.equal(isApple('Mozilla/5.0 (Linux; Android 14)', 'Linux armv8l', 5), false);
});
