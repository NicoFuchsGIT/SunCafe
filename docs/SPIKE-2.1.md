# Spike 2.1 – Gebäudehöhen und Gelände Wien

Ziel laut [ROADMAP](ROADMAP.md): Datensatz und DGM finden, Lizenz prüfen, 1. Bezirk laden, Höhen gegen OSM vergleichen (PRD F2.2, F2.3, offene Frage 1).

## Kandidaten

| Zweck | Datensatz | Zugang | Lizenz | Status |
|---|---|---|---|---|
| Gebäudehöhen | Stadt Wien, Baukörpermodell der Flächen-Mehrzweckkarte (LoD0.4, Baukörper mit Ober- und Unterkante in m ü. A.) | WFS `data.wien.gv.at/daten/geo`, Layer `ogdwien:FMZKBKMOGD` | CC BY 4.0, Namensnennung „Stadt Wien – data.wien.gv.at“ | bestätigt: 678 547 Baukörper; Höhe = `O_KOTE` − `HOEHE_DGM` (beide über Wiener Null), `U_KOTE` ist meist leer; bbox braucht den Zusatz `,EPSG:4326` |
| Gebäude 3D (Alternative) | Stadt Wien, Gebäudemodell LoD2 (CityGML) | Kachel-Downloads, data.gv.at | CC BY 4.0 | nur falls LoD0.4 nicht reicht, deutlich aufwendiger |
| Gelände Nahbereich | Stadt Wien, Geländemodell (Raster, ca. 1 m) | data.gv.at, GeoTIFF-Kacheln | CC BY 4.0 | Auflösung und Kachelschema prüfen |
| Fernhorizont | DGM Österreich 10 m (geoland.at / basemap.at) | data.gv.at | CC BY 4.0 | für den groben 50-m-Raster bis 20 km (Aufgabe 2.4) |

Die Lizenzangaben sind der bekannte Stand der Wiener OGD. Vor Phase 2.8 den Lizenztext auf den Datensatzseiten nachlesen und hier verlinken.

## Höhenvergleich 1. Bezirk

Skript: [`pipeline/spike_heights.py`](../pipeline/spike_heights.py), nur Standardbibliothek.

- Wien-Baukörper per WFS, OSM-Gebäude (ways) per Overpass, gleiches Rechteck.
- Ein Baukörper gehört zum OSM-Gebäude, in dessen Umriss sein Schwerpunkt liegt. Pro OSM-Gebäude zählt der höchste Baukörper.
- OSM-Höhe nach derselben Regel wie der Client (`height`, sonst `building:levels` × 3 m, sonst 15 m).
- Ausgabe: Fehler je OSM-Höhenquelle sowie für „pauschal 15 m“.

Ausführen: Actions → „Spike Wien-Höhen“ → Run workflow. Der Bericht erscheint in der Zusammenfassung des Laufs. Lokal: `python3 pipeline/spike_heights.py > bericht.md`.

Falls die Attribute anders heißen, bricht das Skript ab und listet die vorhandenen Felder. Dann den Workflow mit passenden `top`/`base` neu starten.

## Ergebnis

_Offen: Workflow einmal laufen lassen und den Bericht hier eintragen._

Danach entscheiden:

1. Reicht LoD0.4 (Baukörper mit Ober-/Unterkante) für die Horizontmaske? Erwartung: ja, Dachformen sind für 2°-Sektoren vernachlässigbar.
2. Welche Gelände-Auflösung braucht der Nahbereich (PRD offene Frage 2)?
