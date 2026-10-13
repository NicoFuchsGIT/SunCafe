# Spike 2.1 – Gebäudehöhen und Gelände Wien

Ziel laut [ROADMAP](ROADMAP.md): Datensatz und DGM finden, Lizenz prüfen, 1. Bezirk laden, Höhen gegen OSM vergleichen (PRD F2.2, F2.3, offene Frage 1).

## Kandidaten

| Zweck | Datensatz | Zugang | Lizenz | Status |
|---|---|---|---|---|
| Gebäudehöhen | [Baukörpermodell (LOD0.4) aus der Flächen-MZK Wien](https://www.data.gv.at/katalog/datasets/76c2e577-268f-4a93-bccd-7d5b43b14efd), Stand 11/2025. Baukörper mit Oberkante `O_KOTE` und Geländehöhe `HOEHE_DGM` in m über Wiener Null | WFS `data.wien.gv.at/daten/geo`, Layer `ogdwien:FMZKBKMOGD` | CC BY 4.0 | geprüft, Höhe = `O_KOTE` − `HOEHE_DGM`. `U_KOTE` ist nur bei Überbauungen und Flugdächern gefüllt (Unterkante). |
| Gebäude 3D (Alternative) | [Generalisiertes Dachmodell (LOD2.1) Wien](https://www.data.gv.at/katalog/datasets/86d88cae-ad97-4476-bae5-73488a12776d) | Kachel-Downloads | CC BY 4.0 | nicht nötig, siehe Entscheidung 1 |
| Gelände Wien | [Geländemodell Raster Wien](https://www.data.gv.at/katalog/datasets/1eda4b16-05e3-43c3-b5b0-ef8276df0701), Stand 11/2025 | Kacheln zu 2,5 × 2,5 km (Name z. B. `35_4`), ASCII-Grid oder GeoTIFF, EPSG:31256, ca. 20 MB zip je Kachel, `https://www.wien.gv.at/ma41datenviewer/downloads/geodaten/dgm_asc/<Blatt>_dgm_asc.zip` | CC BY 4.0 | geprüft mit Blatt 35/4: 1 m, 2501 × 2501 Zellen, Höhen in m über Wiener Null (ca. 6,4 m am Donaukanal) |
| Fernhorizont | [DGM Österreich 10 m](https://www.data.gv.at/katalog/datasets/d88a1246-9684-480b-a480-ff63286b35b7) (geoland.at) | eine Datei für ganz Österreich, GeoTIFF, EPSG:31287, `https://gis.ktn.gv.at/OGD/Geographie_Planung/ogd-10m-at.zip` | CC BY 4.0 | laut Katalog geprüft. Download aus der Sandbox geblockt, Größe und Höhenbezug (vermutlich m ü. A.) in Aufgabe 2.4 aus GitHub Actions prüfen |

Lizenzen laut den data.gv.at-Einträgen oben: alle [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de). Namensnennung für Aufgabe 2.8: „Datenquelle: Stadt Wien – data.wien.gv.at“ und „Datenquelle: geoland.at“.

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
2. **Gelände:** Die Baukörper bringen ihre Geländehöhe (`HOEHE_DGM`) schon mit, für Gebäude im Nahbereich braucht es also kein eigenes DGM. Das DGM braucht es nur für den Geländehorizont selbst. Das 1-m-Modell der Stadt endet an der Stadtgrenze, der Wienerwald liegt aber großteils in Niederösterreich. Deshalb DGM Österreich 10 m für den Fernhorizont, auf das 50-m-Raster aus Aufgabe 2.4 vergröbert. Das 1-m-Modell nur, falls sich in 2.4 zeigt, dass Hanglagen innerhalb Wiens feiner gebraucht werden. Achtung: Die Wien-Daten beziehen sich auf Wiener Null (156,68 m ü. A.), DGM Österreich vermutlich auf m ü. A. Beim Kombinieren umrechnen.
