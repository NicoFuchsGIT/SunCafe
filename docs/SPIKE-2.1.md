# Spike 2.1 – Gebäudehöhen und Gelände Wien

Ziel laut [ROADMAP](ROADMAP.md): Datensatz und DGM finden, Lizenz prüfen, 1. Bezirk laden, Höhen gegen OSM vergleichen (PRD F2.2, F2.3, offene Frage 1).

## Kandidaten

| Zweck | Datensatz | Zugang | Lizenz | Status |
|---|---|---|---|---|
| Gebäudehöhen | Stadt Wien, Baukörpermodell der Flächen-Mehrzweckkarte (LoD0.4, Baukörper mit Ober- und Unterkante in m ü. A.) | WFS `data.wien.gv.at/daten/geo`, Layer `ogdwien:FMZKBKMOGD` | CC BY 4.0, Namensnennung „Stadt Wien – data.wien.gv.at“ | bestätigt: 678 547 Baukörper; Höhe = `O_KOTE` − `HOEHE_DGM` (beide über Wiener Null), `U_KOTE` ist meist leer; bbox braucht den Zusatz `,EPSG:4326` |
| Gebäude 3D (Alternative) | Stadt Wien, Gebäudemodell LoD2 (CityGML) | Kachel-Downloads, data.gv.at | CC BY 4.0 | nur falls LoD0.4 nicht reicht, deutlich aufwendiger |
| Gelände Nahbereich | Stadt Wien, Geländemodell (Raster, ca. 1 m) | data.gv.at, GeoTIFF-Kacheln | CC BY 4.0 | nicht genutzt: der WCS der Stadt hat keine Coverages, GeoTIFF bräuchte eine Zusatzbibliothek |
| Gelände (genutzt, 2.4) | Terrain Tiles (AWS Open Data, Terrarium-PNG), in Österreich aus dem DGM 10 m | `s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | Quellen laut Terrain-Tiles-Doku nennen (u. a. data.gv.at, CC BY 4.0) | Zoom 13 (ca. 13 m) bis 2 km, Zoom 11 (ca. 51 m) bis 20 km; Stephansplatz 171,8 m, Prater 160,8 m (Geländehöhe ohne Gebäude) |

Lizenzen (Stand Oktober 2026, für 2.8 geprüft): Die Stadt Wien stellt [Flächen-Mehrzweckkarte](https://www.wien.gv.at/stadtentwicklung/stadtvermessung/geodaten/fmzk/) und [Baukörpermodell](https://www.wien.gv.at/stadtentwicklung/stadtvermessung/geodaten/bkm/) unter CC BY 4.0 bereit, Namensnennung „Datenquelle: Stadt Wien – data.wien.gv.at“. Für das Gelände verlangt die [Terrain-Tiles-Attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) für Österreich „© offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich“ (CC BY 3.0 AT).

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
