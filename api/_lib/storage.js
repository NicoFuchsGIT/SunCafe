// Dünner Adapter um die Upstash-Redis-REST-API (kein SDK, nur fetch). Wer den Anbieter wechselt, tauscht nur diese Datei.
// Variablen: UPSTASH_REDIS_REST_URL/_TOKEN, bei der Vercel-Integration KV_REST_API_URL/_TOKEN, ggf. mit selbstgewähltem Präfix (z. B. SunCafeStorage_KV_REST_API_URL).
// Die Variablen mit READ_ONLY im Namen taugen nicht (kein Schreiben), die REDIS_URL/KV_URL sind keine REST-Adressen.
const find = suffix => {
  const k = Object.keys(process.env).find(n => n === suffix || (n.endsWith('_' + suffix) && !n.includes('READ_ONLY')));
  return k && process.env[k];
};
const env = () => ({
  url: process.env.UPSTASH_REDIS_REST_URL || find('KV_REST_API_URL'),
  token: process.env.UPSTASH_REDIS_REST_TOKEN || find('KV_REST_API_TOKEN')
});

const available = () => { const {url, token} = env(); return !!(url && token); };

async function command(...args) {
  const {url, token} = env();
  if (!url || !token) throw new Error('storage not configured');
  const r = await fetch(url, {
    method: 'POST',
    headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
    body: JSON.stringify(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a))),
    signal: AbortSignal.timeout(5000)
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.error) throw new Error('storage error: ' + (body.error || r.status));
  return body.result;
}

// Mehrere Befehle in einer Anfrage (Upstash /pipeline), ausgeführt in Reihenfolge
async function pipeline(cmds) {
  const {url, token} = env();
  if (!url || !token) throw new Error('storage not configured');
  const r = await fetch(url.replace(/\/+$/, '') + '/pipeline', {
    method: 'POST',
    headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
    body: JSON.stringify(cmds.map(c => c.map(a => String(a)))),
    signal: AbortSignal.timeout(5000)
  });
  const body = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(body) || body.some(x => x.error)) throw new Error('storage error: ' + (r.status));
  return body.map(x => x.result);
}

// Zähler mit Ablauf, z. B. fürs Rate-Limit: erhöht um 1 und setzt beim ersten Aufruf die Lebensdauer
async function incrWithTtl(key, ttlSeconds) {
  // Ein Aufruf statt INCR+EXPIRE: stirbt die Anfrage dazwischen, bliebe der Zähler sonst ewig stehen. NX setzt die Frist nur beim ersten Mal.
  const [n] = await pipeline([['INCR', key], ['EXPIRE', key, ttlSeconds, 'NX']]);
  return n;
}

module.exports = {
  available,
  get: key => command('GET', key),
  // nx: nur setzen, wenn der Schlüssel fehlt; gibt true zurück, wenn gesetzt
  set: async (key, value, {ttl, nx} = {}) => {
    const args = ['SET', key, value];
    if (ttl) args.push('EX', ttl);
    if (nx) args.push('NX');
    return (await command(...args)) === 'OK';
  },
  del: key => command('DEL', key),
  incrWithTtl,
  push: (key, item) => command('RPUSH', key, item),
  range: (key, start = 0, stop = -1) => command('LRANGE', key, start, stop)
};
