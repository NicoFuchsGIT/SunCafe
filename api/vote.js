const crypto = require('node:crypto');
const storage = require('./_lib/storage.js');

const VOTES = ['sun', 'part', 'shade'];
const PREDICTIONS = [...VOTES, 'night', 'closed'];
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const PLACE_RE = /^(node|way|relation)\/\d{1,15}$/;
const LIMITS = {placeSeconds: 30 * 60, hourSeconds: 3600, perDevice: 20, perIp: 60}; // PRD F4.3: 1 Vote pro Ort und Gerät pro 30 min

const num = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const hash = (salt, v) => crypto.createHash('sha256').update(salt + '|' + v).digest('hex').slice(0, 32);

// Gibt den bereinigten Datensatz zurück oder null; übernimmt nur bekannte Felder, nichts Freitext
function parse(b) {
  if (!b || typeof b !== 'object') return null;
  const t = Date.parse(b.t);
  if (!PLACE_RE.test(b.placeId) || !ID_RE.test(b.deviceId) || !VOTES.includes(b.vote) || !PREDICTIONS.includes(b.predicted)
    || !num(b.lat, -90, 90) || !num(b.lng, -180, 180) || !num(b.sunAlt, -90, 90) || !num(b.sunAz, 0, 360)
    || typeof b.modelVersion !== 'string' || b.modelVersion.length > 32 || !(Math.abs(Date.now() - t) < 10 * 60 * 1000)) return null;
  return {placeId: b.placeId, lat: +b.lat.toFixed(5), lng: +b.lng.toFixed(5), t: new Date(t).toISOString(), vote: b.vote,
    predicted: b.predicted, sunAlt: +b.sunAlt.toFixed(1), sunAz: +b.sunAz.toFixed(1), modelVersion: b.modelVersion, onSite: b.onSite === true};
}

const tooMany = (res, seconds) => { res.setHeader('Retry-After', String(seconds)); return res.status(429).json({error: 'rate limited'}); };

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({error: 'method not allowed'}); }
  // Browser senden Origin mit: Anfragen von fremden Seiten ablehnen (kein Schutz gegen Skripte, dafür das Rate-Limit)
  const h0 = req.headers || {}, origin = h0.origin, host = h0['x-forwarded-host'] || h0.host;
  if (origin && host) { let oh = null; try { oh = new URL(origin).host; } catch (e) { /* ungültig */ } if (oh !== host) return res.status(403).json({error: 'forbidden'}); }
  const vote = parse(req.body);
  if (!vote) return res.status(400).json({error: 'bad request'});
  const salt = process.env.VOTE_SALT;
  if (!salt || !storage.available()) return res.status(503).json({error: 'votes unavailable'}); // lieber ablehnen als ohne Limit annehmen
  try {
    const h = req.headers || {};
    const ip = String(h['x-vercel-forwarded-for'] || h['x-real-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const dev = hash(salt, req.body.deviceId);
    // Erst die allgemeinen Zähler, zuletzt die Ort-Sperre, damit abgelehnte Anfragen sie nicht verbrauchen
    if (await storage.incrWithTtl('rl:ip:' + hash(salt, ip), LIMITS.hourSeconds) > LIMITS.perIp) return tooMany(res, LIMITS.hourSeconds);
    if (await storage.incrWithTtl('rl:dev:' + dev, LIMITS.hourSeconds) > LIMITS.perDevice) return tooMany(res, LIMITS.hourSeconds);
    if (!await storage.set(`rl:place:${dev}:${vote.placeId}`, 1, {ttl: LIMITS.placeSeconds, nx: true})) return tooMany(res, LIMITS.placeSeconds);
    await storage.push('votes', JSON.stringify({...vote, dev}));
    return res.status(204).end();
  } catch (e) {
    return res.status(503).json({error: 'votes unavailable'});
  }
};
