# SunCafe – Feature-Roadmap

Grundlage: [PRD.md](PRD.md) · Kapazität: 3–8 h pro Woche (Planung mit ca. 5 h) · Budget: 0 €

Reihenfolge: **erst Fundament und Backend, dann UI.** Jede Phase endet mit einem vorzeigbaren, deployten Stand.

```
2026  Okt     Nov     Dez     Jan     Feb     Mär     Apr     Mai     Jun     Jul+
      ├─P0────────┤
                  ├─P1──────────┤
                                ├─P2─────────────────┤
                                                     ├─P3─────────┤
      ·········· P4 Validierung (laufend, Schwerpunkt ab Frühling: Sonnensaison) ·······
                                                                  ├─P5 UX/PWA ─────▶
```

Der Zeitplan ist bewusst grob. Bei 3 h pro Woche verschiebt sich alles um etwa die Hälfte nach hinten.

---

## Phase 0 – Fundament (ca. 15 h · Okt–Nov 2026)

Ziel: Die Codebasis ist testbar und vorzeigbar, bevor die Rechnung umgebaut wird.

| # | Aufgabe | Aufwand | PRD |
|---|---------|---------|-----|
| 0.1 | `js/app.js` in ES-Module aufteilen: `config`, `geo`, `data` (Overpass/Nominatim/Wetter), `shade`, `hours`, `ui`. Rechenfunktionen ohne DOM. | 5 h | NFR Wartbarkeit |
| 0.2 | Testsetup mit `node:test` (ohne Abhängigkeiten) und erste Tests für `rayHits`, `facadePoints` und `inShade` mit synthetischen Szenen | 4 h | F5.1 |
| 0.3 | GitHub Action „CI“: Lint (ESLint) und Tests bei jedem Push und PR | 2 h | NFR |
| 0.4 | Parameter (15 m, 4 m Offset, Radien, Kettenliste) in `config.js` zentralisieren | 1 h | F5.4 |
| 0.5 | `backend/` löschen, README-Abschnitt „Aufbau“ aktualisieren | 0,5 h | §9 |
| 0.6 | Cache-Busting (`?v=`) automatisieren oder dokumentiert vereinfachen | 1 h | – |
| 0.7 | **Baseline messen:** 10–15 Wiener Cafés vor Ort prüfen und notieren (Start Ground-Truth-Set) | 2 h | F5.2 |

**Fertig, wenn:** CI ist grün, die App verhält sich unverändert, und eine Baseline-Trefferquote ist dokumentiert.

---

## Phase 1 – Horizontmasken und Sonnenminuten (ca. 20 h · Nov 2026–Jan 2027)

Ziel: schnellere und flexiblere Rechnung im Client sowie das Wunschfeature **Sortierung nach Sonnenminuten**.

| # | Aufgabe | Aufwand | PRD |
|---|---------|---------|-----|
| 1.1 | Modul `horizon.js`: Horizontmaske pro Messpunkt aus den Kachel-Gebäuden (z. B. 180 Sektoren à 2°, Höhenwinkel als uint8) | 6 h | F1.1–F1.2 |
| 1.2 | Äquivalenztest: Maske gegen die bisherige Funktion `inShade` auf Zufallsszenen. Abweichung < 1 % der Zeitpunkte. | 3 h | F1.4 |
| 1.3 | Schieber und Anzeige auf Masken-Lookup umstellen | 2 h | F1.2 |
| 1.4 | Modul `sunminutes.js`: Sonnenminuten im Fenster (5-min-Schritt), Öffnungszeiten berücksichtigt | 3 h | F3.1 |
| 1.5 | Sortierung „☀️ meiste Sonne (2 h)“ / „📍 Entfernung“ und Anzeige „☀️ 85 min“ in der Liste | 3 h | F3.2–F3.3 |
| 1.6 | Augenhöhe (1,2 m) als Parameter | 1 h | F1.3 |
| 1.7 | Tests für `sunminutes` (Randfälle: Sonnenuntergang im Fenster, geschlossen, Mitternacht, Zeitzonen) | 2 h | F5.1 |

**Fertig, wenn:** Die Liste lässt sich nach Sonnenminuten sortieren, das Schieben ist ohne Neuberechnung flüssig, und die Tests sind grün.

---

## Phase 2 – Präzisionsdaten Wien (ca. 30 h · Jan–Apr 2027)

Ziel: echte Gebäudehöhen und Gelände für Wien, vorberechnet und kostenlos.

| # | Aufgabe | Aufwand | PRD |
|---|---------|---------|-----|
| 2.1 | **Spike:** Wiener Gebäudedatensatz und DGM finden, Lizenz prüfen, 1. Bezirk laden und Höhen gegen OSM vergleichen ([SPIKE-2.1](SPIKE-2.1.md)) | 5 h | F2.2, F2.3 |
| 2.2 | `pipeline/` (Python): Orte aus `wien.json` lesen, Messpunkte wie im Client erzeugen (Terrasse oder Fassade) | 4 h | F2.1 |
| 2.3 | Horizontmaske aus Gebäuden (Wien-Höhen, OSM als Fallback) | 5 h | F2.2 |
| 2.4 | Gelände einrechnen: Nahbereich aus dem DGM, Fernhorizont grob (z. B. 50-m-Raster bis 20 km) | 5 h | F2.3 |
| 2.5 | Ausgabeformat: quantisiert, nach Kacheln aufgeteilt, ≤ 2 MB gzip; Client-Loader mit Fallback | 4 h | F2.4–F2.5 |
| 2.6 | Gemeinsame Test-Fixtures für JS und Python (gleiche Szene, gleiche Maske) und `pytest` in CI | 3 h | §11 |
| 2.7 | GitHub Action: Pipeline nach dem Wien-Update ausführen, Plausibilitätschecks, bei Fehler alte Datei behalten | 3 h | F2.6 |
| 2.8 | Attribution (Stadt Wien OGD) im Info-Dialog und README, Methodik-Doku | 1 h | NFR Lizenzen |

**Fertig, wenn:** Wien nutzt vorberechnete Masken mit echten Höhen und Gelände, die Ground-Truth-Trefferquote ist gegenüber der Baseline gemessen und die Pipeline läuft automatisch.

---

## Phase 3 – Anonymes Feedback (ca. 15 h · Apr–Mai 2027)

Ziel: 1-Tap-Votes zur Kalibrierung, rechtzeitig zur Terrassensaison.

| # | Aufgabe | Aufwand | PRD |
|---|---------|---------|-----|
| 3.1 | Free-KV auswählen (Upstash, D1 oder Turso; aktuelle Limits prüfen), kleiner Storage-Adapter | 2 h | §9 |
| 3.2 | `api/vote.js`: Validierung, Rate-Limit (Geräte-ID plus gesalzener IP-Hash), Speicherung inklusive Modellvorhersage und Modellversion | 4 h | F4.2–F4.3 |
| 3.3 | UI im Popup: ☀️ / ⛅ / ☁️, optional Standortprüfung (≤ 150 m) oder Flag „nicht vor Ort“ | 4 h | F4.1, F4.4 |
| 3.4 | `api/votes-export` (geschützt per Token) bzw. Skript für den CSV-Export | 2 h | F4.5 |
| 3.5 | Datenschutzhinweis im Info-Dialog, Tests für die API | 3 h | NFR Datenschutz |

**Fertig, wenn:** Votes landen kostenlos und anonym in der DB und lassen sich als CSV exportieren.

---

## Phase 4 – Validierung und Kalibrierung (laufend, ca. 10–15 h · Schwerpunkt Mai–Aug 2027)

| # | Aufgabe | PRD |
|---|---------|-----|
| 4.1 | Ground-Truth-Set auf 20–30 Cafés zu verschiedenen Tages- und Jahreszeiten ausbauen (`validation/groundtruth.csv`) | F5.2 |
| 4.2 | Auswerteskript (Python oder MATLAB, CSV als Schnittstelle): Trefferquote, Konfusionsmatrix, Fehler nach Sonnenhöhe, Tageszeit und Höhenquelle | F5.3 |
| 4.3 | Parameter kalibrieren: Standardhöhe statt pauschal 15 m (eventuell je Gebäudetyp oder Stadtteil), Terrassen-Offset, Augenhöhe | F5.4 |
| 4.4 | Ergebnisse als Methodik- und Validierungsseite dokumentieren (Portfolio) | Z4 |

**Fertig, wenn:** Die Trefferquote in Wien liegt bei mindestens 85 % (oder die Abweichung ist begründet dokumentiert).

---

## Phase 5 – UX/UI und PWA (später · ab Sommer 2027)

Erst nach den Phasen 0–3, wie gewünscht.

- UI-Überarbeitung mobil: Bottom Sheet statt Sidebar, besserer Zeitschieber, Legende
- Sonnen-Timeline als Balken pro Café (Daten liegen ab Phase 1 vor)
- „Beste Stunde“-Empfehlung
- PWA: Manifest, installierbar, Offline-Cache für Karte und Wien-Daten
- Barrierefreiheit (Kontraste, Tastatur, Screenreader)

---

## Backlog (ungeplant, nach Interesse)

| Idee | Notiz |
|------|-------|
| Wolken im Score | Open-Meteo `direct_radiation` bzw. Bewölkung, „Sonne laut Geometrie, aber bewölkt“ |
| Bäume als Schattenwerfer | Wiener Baumkataster (Kronendurchmesser, Höhe), saisonal belaubt |
| Weitere Städte vorberechnen | Dort, wo offene LoD2- oder Höhendaten existieren (z. B. Graz, Berlin, Hamburg) |
| Favoriten | localStorage, ohne Account |
| Remote-Work-Infos | OSM-Tags `internet_access` und Steckdosen anzeigen |
| Hilfe zum Nachtragen in OSM | „Öffnungszeiten fehlen? In OSM ergänzen“ |

---

## Meilensteine im Überblick

| Meilenstein | Inhalt | Ziel |
|-------------|--------|------|
| **M0** | Modular, getestet, CI, Baseline gemessen | Nov 2026 |
| **M1** | Sortierung nach Sonnenminuten live | Jan 2027 |
| **M2** | Wien mit echten Gebäudehöhen und Gelände | Apr 2027 |
| **M3** | Feedback-Votes live (Saisonstart) | Mai 2027 |
| **M4** | Validierungsbericht ≥ 85 % | Aug 2027 |
| **M5** | UI-Relaunch und PWA | Herbst 2027 |
