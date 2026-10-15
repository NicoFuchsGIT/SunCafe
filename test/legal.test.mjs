// Rechtsseiten und Datenschutz-Zusagen: was die Texte behaupten, muss zum Code passen (DSGVO Art. 13, TKG 2021 § 165 Abs. 3, ECG, MedienG)
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const PAGES = ['impressum.html', 'datenschutz.html', 'cookies.html', 'nutzungsbedingungen.html'];
const html = Object.fromEntries(PAGES.map(p => [p, read(p)]));
const index = read('index.html');
const js = readdirSync(new URL('js/', root)).filter(f => f.endsWith('.js')).map(f => [f, read('js/' + f)]);
const idsOf = h => new Set([...h.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

test('Jede Rechtsseite hat Sprache, Titel, genau eine h1, main, deutschen und englischen Abschnitt', () => {
    for (const [p, h] of Object.entries(html)) {
        assert.match(h, /<html lang="de">/, p);
        assert.match(h, /<title>[^<]+ – SunCafe<\/title>/, p);
        assert.match(h, /<meta name="viewport"/, p);
        assert.equal((h.match(/<h1[ >]/g) || []).length, 1, `${p}: genau eine h1`);
        assert.match(h, /<main>/, p);
        assert.match(h, /<section id="de" lang="de">/, p);
        assert.match(h, /<section id="en" lang="en">/, p);
        const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
        assert.equal(new Set(ids).size, ids.length, `${p}: doppelte IDs`);
    }
});

test('Interne Links und Anker der Rechtsseiten und der App zeigen auf Vorhandenes', () => {
    const all = {...html, 'index.html': index};
    for (const [p, h] of Object.entries(all)) {
        for (const m of h.matchAll(/href="([^"#:]*)(#[^"]*)?"/g)) {
            const [, file, hash] = m;
            const target = file || p;
            if (target === './') continue;
            assert.ok(existsSync(new URL(target, root)), `${p}: ${target} fehlt`);
            if (hash && target.endsWith('.html')) assert.ok(idsOf(read(target)).has(hash.slice(1)), `${p}: Anker ${target}${hash} fehlt`);
        }
    }
    // Anker, die ui.js für die Vote-Notiz setzt
    const ui = read('js/ui.js');
    for (const id of ['rueckmeldungen', 'reports']) {
        assert.ok(ui.includes(`'${id}'`), `ui.js verlinkt ${id}`);
        assert.ok(idsOf(html['datenschutz.html']).has(id), `datenschutz.html braucht #${id}`);
    }
});

test('Die App verlinkt alle vier Rechtsseiten (Info-Dialog und Liste)', () => {
    for (const p of PAGES) assert.ok((index.match(new RegExp(`href="${p}"`, 'g')) || []).length >= 2, `${p} nur ${(index.match(new RegExp(`href="${p}"`, 'g')) || []).length}× verlinkt`);
});

test('Keine Cookies: weder im Browser-Code noch in den API-Funktionen', () => {
    for (const [f, src] of js) assert.ok(!/document\.cookie/.test(src), `${f} setzt Cookies`);
    for (const f of ['api/vote.js', 'api/overpass.js', 'api/votes-export.js', 'api/_lib/storage.js']) assert.ok(!/set-cookie/i.test(read(f)), `${f} setzt Cookies`);
});

test('localStorage nur für Sprache und Votes; jeder Eintrag steht auf der Cookie-Seite', () => {
    const users = js.filter(([, src]) => /localStorage/.test(src)).map(([f]) => f).sort();
    assert.deepEqual(users, ['i18n.js', 'vote.js'], 'neue localStorage-Nutzung braucht Prüfung (Einwilligung?) und einen Eintrag in cookies.html');
    const keys = new Set();
    for (const [, src] of js) for (const m of src.matchAll(/['"`](suncafe\.[a-z]+|sc:c2|nom|rg):?/g)) keys.add(m[1]);
    assert.ok(keys.size >= 6, [...keys].join());
    for (const k of keys) assert.ok(html['cookies.html'].includes(k), `cookies.html nennt ${k} nicht`);
});

test('Geräte-ID wird nicht beim bloßen Öffnen des Sheets angelegt (nur beim Senden)', () => {
    const ui = read('js/ui.js');
    const check = ui.match(/const payload = [^\n]*buildVote\([^\n]*\)/)[0];
    assert.ok(/device: ''/.test(check), 'voteBox darf deviceId() nicht aufrufen');
    assert.equal((ui.match(/deviceId\(\)/g) || []).length, 1, 'deviceId() nur im Klick-Handler');
});

test('Alle Fremdserver der CSP stehen in der Datenschutzerklärung', () => {
    const csp = JSON.parse(read('vercel.json')).headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
    const hosts = [...csp.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map(m => m[1]);
    assert.ok(hosts.length >= 8);
    for (const h of hosts) assert.ok(html['datenschutz.html'].includes(h), `${h} fehlt in datenschutz.html`);
});

test('Keine Fremdinhalte eingebunden: Skripte, Stile, Bilder, Frames nur vom eigenen Server', () => {
    for (const [p, h] of Object.entries({...html, 'index.html': index, '404.html': read('404.html')})) {
        for (const m of h.matchAll(/<(?:script|link|img|iframe|source|embed|object)\b[^>]*?(?:src|href|data)="([^"]+)"/g)) {
            if (/<link\b/.test(m[0]) && /rel="(?:preconnect|dns-prefetch)"/.test(m[0])) continue; // Verbindung nur zu Diensten, die ohnehin gebraucht werden
            assert.ok(!/^(https?:)?\/\//.test(m[1]), `${p}: Fremdressource ${m[1]}`);
        }
        assert.ok(!/<iframe|<embed|<object/.test(h), `${p}: Einbettung`);
    }
    const css = read('css/style.css') + read('css/legal.css');
    assert.ok(!/@import|url\(\s*['"]?https?:/.test(css), 'CSS lädt Fremdes');
    for (const [f, src] of js) assert.ok(!/google-analytics|googletagmanager|gtag\(|plausible|matomo|hotjar|sentry|facebook|fbq\(/i.test(src), `${f}: Tracking?`);
    assert.ok(!/analytics|insights/i.test(read('vercel.json')), 'Vercel Analytics in vercel.json');
});

test('Bilder haben Alt-Text, Schaltflächen und Felder in der App einen zugänglichen Namen', () => {
    for (const [p, h] of Object.entries({...html, 'index.html': index})) for (const m of h.matchAll(/<img\b[^>]*>/g)) assert.match(m[0], /\salt="/, `${p}: Bild ohne alt`);
    for (const m of index.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
        const [, attrs, inner] = m;
        const text = inner.replace(/<[^>]+>/g, '').trim();
        assert.ok(text || /aria-label|data-i18n/.test(attrs) || /data-i18n/.test(inner), `Schaltfläche ohne Namen: ${m[0].slice(0, 90)}`);
    }
    for (const m of index.matchAll(/<(input|select)\b([^>]*)>/g)) {
        const attrs = m[2], id = (attrs.match(/\sid="([^"]+)"/) || [])[1];
        const labelled = /aria-label/.test(attrs) || (id && new RegExp(`for="${id}"`).test(index)) || index.slice(0, m.index).lastIndexOf('<label') > index.slice(0, m.index).lastIndexOf('</label>');
        assert.ok(labelled, `Feld ohne Beschriftung: ${m[0].slice(0, 90)}`);
    }
    assert.match(index, /<main id="app"/, 'Hauptbereich ist ein main-Landmark');
});

// Platzhalter (Name, Anschrift, E-Mail, DB-Region) sind gelb markiert. Solange welche offen sind, erscheint dieser Test als TODO.
test('Impressum und Datenschutzerklärung: alle Pflichtangaben sind ausgefüllt', {todo: 'Platzhalter in impressum.html und datenschutz.html ausfüllen'}, () => {
    const open = PAGES.flatMap(p => [...html[p].matchAll(/<mark class="todo">([^<]*)<\/mark>/g)].map(m => `${p}: ${m[1]}`));
    assert.deepEqual(open, []);
});
