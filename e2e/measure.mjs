// D3.6: Ladezeit auf gedrosseltem Netz (Mobile-Emulation 390×844, Stephansplatz). Kein Teil von `npm test`.
// Aufruf: PLAYWRIGHT_MODULE=… [CHROMIUM_PATH=…] node e2e/measure.mjs [Durchläufe]
// Misst Zeit bis zum ersten Café in der Liste („Erste Cafés“) und bis der Status keine Berechnung mehr meldet („Fertig“, Schatten für alle Orte da).
// Der Server liefert wie Vercel gzip-komprimiert; Karte, Wetter und Nominatim laufen über das echte Netz.
import http from 'node:http';
import zlib from 'node:zlib';
import {readFileSync, existsSync, statSync} from 'node:fs';
import {extname, join, resolve} from 'node:path';

const ROOT = resolve(import.meta.dirname, '..'), RUNS = +process.argv[2] || 3;
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml'};
// Durchsatz in Byte/s, Latenz in ms
const NETS = {'4G': {downloadThroughput: 9e6 / 8, uploadThroughput: 9e6 / 8, latency: 85}, 'langsames 3G': {downloadThroughput: 400e3 / 8, uploadThroughput: 400e3 / 8, latency: 400}};

const server = http.createServer((q, r) => {
    let p = q.url.split('?')[0]; if (p === '/') p = '/index.html';
    const f = join(ROOT, p);
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); }
    const type = TYPES[extname(f)] || 'application/octet-stream', body = readFileSync(f);
    r.setHeader('content-type', type);
    if (type !== 'font/woff2') { r.setHeader('content-encoding', 'gzip'); r.end(zlib.gzipSync(body)); } else r.end(body);
}).listen(0);
const base = 'http://localhost:' + server.address().port;
const browser = await pw.chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});

async function once(net) {
    const ctx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'de-AT', timezoneId: 'Europe/Vienna',
        geolocation: {latitude: 48.2082, longitude: 16.3738}, permissions: ['geolocation']});
    const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {offline: false, ...NETS[net]});
    let bytes = 0, reqs = 0;
    cdp.on('Network.loadingFinished', e => { bytes += e.encodedDataLength; reqs++; });
    const t0 = Date.now();
    await page.goto(base, {waitUntil: 'commit'});
    await page.waitForSelector('#list li', {state: 'attached', timeout: 120000});
    const first = Date.now() - t0;
    await page.waitForFunction(() => { const x = document.getElementById('status').textContent; return /\d/.test(x) && !/…|\.\.\./.test(x); }, null, {timeout: 120000});
    const done = Date.now() - t0;
    await ctx.close();
    return {first, done, bytes, reqs};
}

const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const net of Object.keys(NETS)) {
    const res = []; for (let i = 0; i < RUNS; i++) res.push(await once(net));
    console.log(`${net}: erste Cafés ${(med(res.map(r => r.first)) / 1000).toFixed(1)} s · fertig ${(med(res.map(r => r.done)) / 1000).toFixed(1)} s · ${(med(res.map(r => r.bytes)) / 1e6).toFixed(2)} MB in ${med(res.map(r => r.reqs))} Requests (Median aus ${RUNS})`);
}
await browser.close(); server.close();
