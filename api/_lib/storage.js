// Dünner Adapter um die Upstash-Redis-REST-API (kein SDK, nur fetch). Wer den Anbieter wechselt, tauscht nur diese Datei.
// Variablen: UPSTASH_REDIS_REST_URL/_TOKEN, bei der Vercel-Integration auch KV_REST_API_URL/_TOKEN.
const env = () => ({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
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

// Zähler mit Ablauf, z. B. fürs Rate-Limit: erhöht um 1 und setzt beim ersten Aufruf die Lebensdauer
async function incrWithTtl(key, ttlSeconds) {
  const n = await command('INCR', key);
  if (n === 1) await command('EXPIRE', key, ttlSeconds);
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
