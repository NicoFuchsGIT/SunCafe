const crypto = require('node:crypto');
const storage = require('./_lib/storage.js');

const COLUMNS = ['t', 'placeId', 'lat', 'lng', 'vote', 'predicted', 'sunAlt', 'sunAz', 'modelVersion', 'onSite', 'dev'];

const same = (a, b) => { const x = crypto.createHash('sha256').update(a).digest(), y = crypto.createHash('sha256').update(b).digest(); return crypto.timingSafeEqual(x, y); };
// Felder sind von vote.js bereinigt; trotzdem quoten, falls ein Wert Komma oder Anführungszeichen enthält
const cell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

// GET mit Header "Authorization: Bearer <VOTES_EXPORT_TOKEN>"; liefert alle Votes als CSV (UTF-8, Kopfzeile, sortiert nach Zeit)
module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({error: 'method not allowed'}); }
  const token = process.env.VOTES_EXPORT_TOKEN;
  if (!token || !storage.available()) return res.status(503).json({error: 'export unavailable'});
  const m = /^Bearer (.+)$/.exec((req.headers || {}).authorization || '');
  if (!m || !same(m[1], token)) return res.status(401).json({error: 'unauthorized'});
  try {
    const rows = [];
    for (const raw of await storage.range('votes')) { try { rows.push(JSON.parse(raw)); } catch (e) { /* defekten Eintrag überspringen */ } }
    rows.sort((a, b) => a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="votes.csv"');
    return res.status(200).send([COLUMNS.join(','), ...rows.map(r => COLUMNS.map(c => cell(r[c])).join(','))].join('\n') + '\n');
  } catch (e) {
    return res.status(503).json({error: 'export unavailable'});
  }
};
