// ---------- Einstellungen ----------
export const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'; // TODO: gegen Protomaps/PMTiles tauschen
export const WIEN = {lat: 48.2082, lng: 16.3738};
export const WIEN_RANGE = 5000; // Umkreis um den Stephansplatz, den data/wien.json abdeckt
export const OVERPASS = ['https://overpass-api.de/api/interpreter','https://lz4.overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://overpass.openstreetmap.fr/api/interpreter'];

// Radien in Metern
export const CAFE_RADIUS = 1000;          // Suchradius für Cafés um den gewählten Ort
export const RINGS = [300, 600, 1050];    // Entfernungsringe auf der Karte
export const SHADOW_REACH = 300;          // weiter reicht kein Schatten in die Rechnung ein
export const TERRACE_MATCH_RADIUS = 25;   // OSM-Terrasse gehört zum nächsten Café innerhalb dieses Abstands

// Kalibrierbare Parameter der Schattenrechnung (PRD F5.4)
export const DEFAULT_HEIGHT = 15;  // m, Gebäude ohne height/building:levels
export const LEVEL_HEIGHT = 3;     // m pro Stockwerk bei building:levels
export const TERRACE_OFFSET = 4;   // m, geschätzte Terrasse vor der Fassade

// Horizontmaske (PRD F1.1): Anzahl Azimut-Sektoren, 180 = 2° pro Sektor
export const HORIZON_SECTORS = 180;

export const STEP_MIN = 30, MIN_ALT = 0;

// Sonnenminuten (PRD F3.1): Fenster ab dem gewählten Zeitpunkt und Abtastschritt, in Minuten
export const SUN_WINDOW_MIN = 120, SUN_STEP_MIN = 5;

// Ketten, die nicht angezeigt werden
export const BAD_CHAINS = ['der mann','aida','felber','ströck','stroeck','anker','unbekannt','tchibo', 'geier', 'admiral sportsbar', 'wild bean cafe'];
export const DAYS = ['So','Mo','Di','Mi','Do','Fr','Sa'];
// Ketten nur als ganze Wörter erkennen, sonst trifft 'anker' auch 'Schmankerl' (Unicode-fähig wegen 'ströck')
export const BAD_CHAIN_RE = new RegExp('(?<![\\p{L}\\p{N}])(' + BAD_CHAINS.join('|') + ')(?![\\p{L}\\p{N}])', 'iu');
