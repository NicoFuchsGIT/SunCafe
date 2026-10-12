// ---------- Einstellungen ----------
export const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'; // TODO: gegen Protomaps/PMTiles tauschen
export const WIEN = {lat: 48.2082, lng: 16.3738};
export const WIEN_RANGE = 5000; // Umkreis um den Stephansplatz, den data/wien.json abdeckt
export const OVERPASS = ['https://overpass-api.de/api/interpreter','https://lz4.overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://overpass.openstreetmap.fr/api/interpreter'];
export const CAFE_RADIUS = 1000, RINGS = [300, 600, 1050], STEP_MIN = 30, TERRACE_OFFSET = 4, MIN_ALT = 0, SHADOW_REACH = 300;
export const BAD_CHAINS = ['der mann','aida','felber','ströck','stroeck','anker','unbekannt','tchibo', 'geier', 'admiral sportsbar', 'wild bean cafe'];
export const DAYS = ['So','Mo','Di','Mi','Do','Fr','Sa'];
// Ketten nur als ganze Wörter erkennen, sonst trifft 'anker' auch 'Schmankerl' (Unicode-fähig wegen 'ströck')
export const BAD_CHAIN_RE = new RegExp('(?<![\\p{L}\\p{N}])(' + BAD_CHAINS.join('|') + ')(?![\\p{L}\\p{N}])', 'iu');
