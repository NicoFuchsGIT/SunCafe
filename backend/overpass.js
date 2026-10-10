const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter'
];

module.exports = async (req, res) => {
  const q = req.query.data;
  if (typeof q !== 'string' || !q.startsWith('[out:json]') || q.length > 1500) {
    return res.status(400).json({error: 'bad request'});
  }
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