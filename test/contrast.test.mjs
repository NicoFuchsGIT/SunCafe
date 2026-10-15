// D3.3: WCAG-Kontrast der Farbtokens in beiden Modi (css/style.css) und der Marker auf hellem und dunklem Kartengrund
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
const tokens = block => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)].map(m => [m[1], m[2].length === 4 ? '#' + [...m[2].slice(1)].map(c => c + c).join('') : m[2]]));
const light = tokens(css.match(/:root\{([^}]*)\}/)[1]);
const dark = {...light, ...tokens(css.match(/html\.dark\{([^}]*)\}/)[1])};

const lum = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return .2126 * r + .7152 * g + .0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };

for (const [name, th] of [['hell', light], ['dunkel', dark]]) {
    test(`Text hat in ${name} mindestens 4,5:1`, () => {
        for (const [fg, bg] of [['ink', 'bg'], ['ink', 'card'], ['mute', 'bg'], ['mute', 'card']]) {
            assert.ok(ratio(th[fg], th[bg]) >= 4.5, `${fg} auf ${bg}: ${ratio(th[fg], th[bg]).toFixed(2)}`);
        }
    });
    test(`Schieber-Spur hat in ${name} mindestens 3:1`, () => {
        assert.ok(ratio(th.track, th.bg) >= 3, `track auf bg: ${ratio(th.track, th.bg).toFixed(2)}`);
    });
}

// Marker tragen eine weiße Außenkante (js/ui.js markerImage); die Füllung muss sich davon und vom Kartengrund abheben
test('Markerfüllung und -rand heben sich von Weiß und vom dunklen Kartengrund ab', () => {
    const ui = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
    const marks = [...ui.matchAll(/(\w+): \{fill:'(#\w{6})', ink:'(#\w{6})', rim:'(#\w{6})'/g)];
    assert.ok(marks.length >= 6);
    for (const [, key, fill, ink, rim] of marks) {
        assert.ok(ratio(ink, fill) >= 3, `${key}: Symbol auf Füllung ${ratio(ink, fill).toFixed(2)}`);
        assert.ok(ratio(rim, '#ffffff') >= 3, `${key}: Rand auf Weiß ${ratio(rim, '#ffffff').toFixed(2)}`);
    }
});
