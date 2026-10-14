# Methodik

Wie SunCafe schätzt, ob an einem Café gerade Sonne ist. Kurzfassung für Nutzer steht im Info-Dialog (`index.html`).

## Messpunkte

Pro Ort ein oder mehrere Punkte, an denen man sitzt (`js/shade.js`, gleich in `pipeline/points.py`):

1. Liegt eine OSM-Terrasse oder ein Biergarten (`leisure=outdoor_seating`, `amenity=biergarten`) höchstens 25 m entfernt, ist sie der Messpunkt.
2. Sonst Punkte 4 m vor den Fassaden des eigenen Gebäudes, bei Eckhäusern je Straßenseite einer.
3. Sonst die OSM-Position selbst.

Gerechnet wird aus Augenhöhe, 1,2 m über Grund.

## Horizontmaske

Für jeden Messpunkt wird einmal eine Maske berechnet: 180 Sektoren à 2° Azimut, je Sektor der größte Höhenwinkel, unter dem Gebäude oder Gelände den Himmel verdecken (uint8, 0–255 ≙ 0–90°). Gebäude zählen bis 300 m. Danach ist jeder Zeitpunkt nur ein Lookup: Sonne steht im Sektor über der Maske → Sonne, sonst Schatten. Sonne unter 0,5° gilt als untergegangen.

Ein Ort mit mehreren Messpunkten zeigt „Teils Sonne“, wenn sich die Punkte unterscheiden. Sonnenminuten zählen die Minuten mit Sonne in den 2 Stunden ab der gewählten Zeit (5-min-Schritt), solange geöffnet ist.

## Zwei Wege zur Maske

| | Wien (vorberechnet) | sonst (im Browser) |
|---|---|---|
| Gebäudeumrisse | OSM über Overpass | Gebäude aus den Kartenkacheln (OpenFreeMap) |
| Gebäudehöhen | Baukörpermodell der Stadt Wien (`O_KOTE` − `HOEHE_DGM`), pro OSM-Gebäude der höchste Baukörper; ohne Treffer OSM-Höhe | `render_height` der Kacheln (aus OSM `height` bzw. Geschossen), sonst 15 m |
| Gelände | Höhenunterschied zwischen Ort und Gebäude; Geländehorizont bis 20 km (bis 2 km ca. 13 m Raster, danach ca. 51 m) mit Erdkrümmung und Refraktion 0,13 | nicht berücksichtigt (flach) |
| Ablage | `data/horizon/<Kachel>.json`, Kacheln 0,02° × 0,02°, Maske Base64 | nur im Speicher |

Der Client lädt für Wiener Orte zuerst die passende Kachel (`loadHorizon` in `js/data.js`). Fehlt die Kachel oder der Ort darin (z. B. neues Café seit dem letzten Lauf), rechnet er wie überall sonst selbst.

## Aktualisierung

`.github/workflows/update-wien.yml` lädt am 1. und 15. jedes Monats die Orte neu (`data/wien.json`) und rechnet danach die Masken (`pipeline/points.py --out data/horizon`). Vor dem Schreiben prüft `check()`:

- mindestens 1000 Gebäude von Overpass,
- mindestens die Hälfte davon mit Wien-Höhe,
- höchstens die Hälfte der Orte ohne jeden Horizont,
- mindestens 70 % der bisherigen Orte,
- alle Kacheln zusammen höchstens 2 MB gzip.

Schlägt eine Prüfung fehl, bricht der Lauf ab und die alten Kacheln bleiben im Repo.

JS und Python rechnen mit denselben Test-Fixtures (`test/fixtures`, `pipeline/test_*.py`), damit beide Wege dieselbe Maske liefern.

## Grenzen

- Bäume, Schirme, Markisen und Wolken fehlen. Die Bewölkung wird nur angezeigt.
- Dachformen sind als flache Prismen modelliert; bei 2°-Sektoren ist das vernachlässigbar.
- Der Geländehorizont gilt einmal pro Ort, nicht pro Messpunkt (Punkte liegen höchstens etwa 30 m auseinander).
- Außerhalb Wiens hängt die Genauigkeit von den OSM-Höhen ab; ohne Angabe gelten pauschal 15 m.
- Bei Cafés in Innenhöfen ist die Position unsicher.

## Quellen und Lizenzen

- OpenStreetMap contributors, ODbL
- Datenquelle: Stadt Wien – data.wien.gv.at, CC BY 4.0 (Baukörpermodell der Flächen-Mehrzweckkarte, WFS-Layer `ogdwien:FMZKBKMOGD`)
- © offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich, CC BY 3.0 AT, über [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)

Details zur Auswahl der Datensätze: [SPIKE-2.1](SPIKE-2.1.md).
