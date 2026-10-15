const SERVERS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter'
];

const PTYPES = ['cafe', 'bar', 'rest']; // ptype ist eine kommagetrennte Liste daraus

// Nimmt nur Ort und Kategorie an und baut die Abfrage selbst, sonst wäre das ein offener Overpass-Proxy
module.exports = async (req, res) => {
  const {lat, lng, ptype} = req.query;
  // Auf 3 Stellen gerundet wie der Client: gleiche Orte treffen denselben Cache-Eintrag
  const la = Math.round(parseFloat(lat) * 1000) / 1000, ln = Math.round(parseFloat(lng) * 1000) / 1000; // parseFloat: leer → NaN
  if (!(Math.abs(la) <= 90) || !(Math.abs(ln) <= 180) || !/^[a-z,]{1,20}$/.test(ptype || '') || ptype.split(',').some(k => !PTYPES.includes(k))) {
    return res.status(400).json({error: 'bad request'});
  }
  const {cafeQuery} = await import('../js/data.js');
  const q = cafeQuery(la, ln, ptype);
  // Alle Server gleichzeitig fragen: einzeln nacheinander passt das nicht ins Zeitlimit der Funktion, wenn einige langsam oder kaputt sind
  const ctl = new AbortController();
  let empty = null;
  const ask = async url => {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SunCafe/1.0 (+https://suncafe-nu.vercel.app)'
      },
      body: 'data=' + encodeURIComponent(q),
      signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(25000)])
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const text = await r.text();
    // Überlastete Server liefern oft 200 mit „remark“ oder ohne Elemente
    const data = JSON.parse(text);
    if (!Array.isArray(data.elements) || data.remark) throw new Error('overload');
    if (!data.elements.length) { empty = empty || text; throw new Error('empty'); } // leer kann stimmen oder Überlast sein
    return text;
  };
  try {
    const text = await Promise.any(SERVERS.map(ask));
    ctl.abort();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(text);
  } catch (e) { /* kein Server hat geliefert */ }
  if (empty) { // alle Server meldeten nichts: ausliefern, aber nicht cachen
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(empty);
  }
  res.status(502).json({error: 'overpass unavailable'});
};