# Spike 2.1 – Gebäudehöhen und Gelände Wien

Ziel laut [ROADMAP](ROADMAP.md): Datensatz und DGM finden, Lizenz prüfen, 1. Bezirk laden, Höhen gegen OSM vergleichen (PRD F2.2, F2.3, offene Frage 1).

## Kandidaten

| Zweck | Datensatz | Zugang | Lizenz | Status |
|---|---|---|---|---|
| Gebäudehöhen | Stadt Wien, Baukörpermodell der Flächen-Mehrzweckkarte (LoD0.4, Baukörper mit Oberkante `O_KOTE` und Geländehöhe `HOEHE_DGM`, beide in m über Wiener Null) | WFS `data.wien.gv.at/daten/geo`, Layer `ogdwien:FMZKBKMOGD` | CC BY 4.0, Namensnennung „Stadt Wien – data.wien.gv.at“ | bestätigt, Höhe = `O_KOTE` − `HOEHE_DGM`. `U_KOTE` ist nur bei Überbauungen und Flugdächern gefüllt (Unterkante). |
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

Stolpersteine: Der WFS liest eine bbox ohne CRS-Angabe im Layer-CRS und liefert dann 0 Baukörper, deshalb hängt das Skript `,EPSG:4326` an. Overpass ist aus der Claude-Sandbox nicht erreichbar, nur aus GitHub Actions.

## Ergebnis

Lauf vom 13.10.2026 ([Actions-Run](https://github.com/NicoFuchsGIT/SunCafe/actions/runs/38454092377)): 15.794 Wien-Baukörper, 2.131 OSM-Gebäude, davon 1.885 zugeordnet.

| OSM-Quelle | n | Anteil | Median \|Fehler\| (m) | Mittel Fehler OSM−Wien (m) | Anteil ±3 m |
|---|---|---|---|---|---|
| `height` | 953 | 51 % | 2,9 | +0,3 | 52 % |
| `building:levels` × 3 m | 733 | 39 % | 6,4 | −6,6 | 23 % |
| Standard 15 m | 199 | 11 % | 10,0 | +3,1 | 10 % |
| alle (Client-Regel) | 1885 | 100 % | 4,3 | −2,1 | 36 % |
| pauschal 15 m | 1885 | 100 % | 10,4 | −7,7 | 10 % |

Wien-Höhen: Median 24,2 m, Min 1,2 m, Max 136,1 m (Stephansdom).

Erkenntnisse:

- Selbst die beste OSM-Quelle (`height`) trifft nur jedes zweite Gebäude auf ±3 m. Die Wien-Daten sind für die Präzisionsstufe klar besser.
- `building:levels` × 3 m unterschätzt um rund 6,6 m. Wiener Altbau hat höhere Geschosse, dazu kommt das Dach. Für den OSM-Fallback (Aufgabe 2.3) eher ca. 4 m je Geschoss annehmen. Ob das auch für die Client-Regel gilt, prüft Aufgabe 4.3.
- Pauschal 15 m ist im 1. Bezirk deutlich zu niedrig (Median 24 m).

## Entscheidungen

1. **LoD0.4 reicht.** Gebäudehöhe = `O_KOTE` − `HOEHE_DGM` aus `ogdwien:FMZKBKMOGD`, pro Baukörper (ein Gebäude besteht aus mehreren Baukörpern mit eigener Höhe, das bildet gestufte Dächer und Türme bereits ab). LoD2 ist für 2°-Sektoren nicht nötig. OSM nur als Fallback außerhalb der Wien-Daten.
2. **Gelände:** Die Baukörper bringen ihre Geländehöhe (`HOEHE_DGM`) schon mit, für Gebäude im Nahbereich braucht es also kein eigenes DGM. Das DGM braucht es nur für den Geländehorizont selbst. Dafür sind die 10 m von DGM Österreich vermutlich genug (Annahme, in Aufgabe 2.4 gegen das 1-m-Modell der Stadt prüfen). Achtung: Wien-Höhen beziehen sich auf Wiener Null (156,68 m ü. A.), DGM Österreich auf m ü. A. Beim Kombinieren umrechnen.
