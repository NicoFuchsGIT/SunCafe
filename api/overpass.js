const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter'
];

const PTYPES = ['cafe', 'bar', 'rest'];

// Nimmt nur Ort und Kategorie an und baut die Abfrage selbst, sonst wäre das ein offener Overpass-Proxy
module.exports = async (req, res) => {
  const {lat, lng, ptype} = req.query;
  // Auf 3 Stellen gerundet wie der Client: gleiche Orte treffen denselben Cache-Eintrag
  const la = Math.round(parseFloat(lat) * 1000) / 1000, ln = Math.round(parseFloat(lng) * 1000) / 1000; // parseFloat: leer → NaN
  if (!(Math.abs(la) <= 90) || !(Math.abs(ln) <= 180) || !PTYPES.includes(ptype)) {
    return res.status(400).json({error: 'bad request'});
  }
  const {cafeQuery} = await import('../js/data.js');
  const q = cafeQuery(la, ln, ptype);
  for (const url of SERVERS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SunCafe/1.0 (+https://suncafe-nu.vercel.app)'
        },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) continue;
      const text = await r.text();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).send(text);
    } catch (e) { /* nächster Server */ }
  }
  res.status(502).json({error: 'overpass unavailable'});
};