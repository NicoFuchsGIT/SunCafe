# SunCafe – Product Requirements Document

Stand: Oktober 2026 · Autor: Nico Fuchs · Status: Entwurf v1

## 1. Kontext

SunCafe ist eine Web-App (MapLibre, OpenStreetMap, Vercel), die Cafés und Bäckereien in der Nähe zeigt und schätzt, ob dort gerade Sonne oder Gebäudeschatten ist. Ein Zeitschieber reicht bis 48 h voraus, dazu kommen Öffnungszeiten und Wetter.

Aktueller Stand:

- Die Schattenrechnung läuft komplett im Browser: Pro Messpunkt wird einmal eine Horizontmaske aus den Gebäuden der OpenFreeMap-Vektorkacheln berechnet, danach ist jeder Zeitpunkt ein Lookup. Fehlt die Höhe, gelten 15 m.
- Für Wien liegt ein vorab geladener Datensatz bei (`data/wien.json`, ca. 5.100 Orte, Update per GitHub Action). Weltweit wird live über Overpass abgefragt (`api/overpass.js` als Proxy mit Cache).
- Der Code ist in ES-Module unter `js/` aufgeteilt, mit Tests (`node:test`) und CI (Phase 0). Horizontmasken und Sonnenminuten sind umgesetzt (Phase 1).
- Das frühere `backend/` (FastAPI auf Render) wurde wegen der Cold Starts im Free Tier gelöscht, die Rechnung im Client reicht aus.

## 2. Vision

> „Wo kann ich mich jetzt – oder in der nächsten Stunde – mit einem Kaffee in die Sonne setzen?“

SunCafe beantwortet diese Frage möglichst genau, schnell und kostenlos. Das Projekt ist ein **Spaßprojekt für mich und Freunde und gleichzeitig ein Portfolio-Stück**. Der Fokus liegt auf einem robusten, sauber gebauten Kern (Daten, Rechnung, Validierung). Die UI-Überarbeitung kommt bewusst später.

## 3. Ziele und Nicht-Ziele

### Ziele (12 Monate)

| # | Ziel | Messbar durch |
|---|------|---------------|
| Z1 | Spürbar genauere Sonne/Schatten-Schätzung, besonders in Wien | Trefferquote gegen Votes und Ground Truth (siehe §8) |
| Z2 | „Wann ist wo am meisten Sonne?“ beantworten | Liste sortierbar nach Sonnenminuten |
| Z3 | Rückmeldung aus der Nutzung sammeln, um das Modell zu kalibrieren | Anonymes 1-Tap-Voting live, Auswertung möglich |
| Z4 | Vorzeigbare Codebasis | Module, Tests, CI und Doku (siehe §8) |
| Z5 | 0 € Betriebskosten | Nur Free Tiers |

### Nicht-Ziele

- Keine Monetarisierung, kein Wachstums-Marketing, keine Nutzerzahl-Ziele
- Keine Accounts und kein Login
- Keine native iOS- oder Android-App (Web bzw. später PWA reicht)
- Kein UI-Redesign vor Abschluss der Backend-Phasen
- Bäume, Markisen und Schirme als Schattenwerfer vorerst nicht (Backlog)

## 4. Zielgruppen

| Persona | Beschreibung | Kernbedürfnis |
|---------|--------------|---------------|
| **Lena, Local in Wien** | Wohnt im 7. Bezirk und entscheidet spontan am Wochenende | „Welches Café in Gehweite hat *jetzt* Sonne und ist offen?“ |
| **Jonas, Student / Remote Worker** | Will 2–3 h draußen sitzen, auch mit Laptop | „Wo habe ich die *nächsten Stunden* durchgehend Sonne?“ |
| **Freunde auf Reisen** | Nutzen die App ab und zu außerhalb Wiens | „Funktioniert es auch in Barcelona brauchbar?“ |

Geo-Fokus: **weltweit gleichwertig nutzbar.** Wien bekommt zusätzlich einen festen, vorab berechneten Datensatz mit höherer Präzision. Er ist Backup und Showcase zugleich.

## 5. User Stories

- **US1:** Als Local will ich sehen, welche Cafés in meiner Nähe jetzt Sonne haben, um spontan loszugehen. *(besteht)*
- **US2:** Als Remote Worker will ich die Liste nach „Sonnenminuten in den nächsten 2 h“ sortieren, um einen Platz zu finden, an dem ich länger sitzen kann.
- **US3:** Als Nutzer in Wien will ich, dass echte Gebäudehöhen und Hanglagen berücksichtigt werden, damit ich der Anzeige vertrauen kann.
- **US4:** Als Nutzer vor Ort will ich mit einem Tap melden, ob die Anzeige stimmt („☀️ stimmt“ / „☁️ eigentlich Schatten“), ohne mich anzumelden.
- **US5:** Als Entwickler will ich Votes exportieren und auswerten (Konfusionsmatrix, Fehler nach Tageszeit und Gebäudehöhe), um Parameter wie die Standardhöhe oder den Terrassen-Offset zu kalibrieren.
- **US6:** Als Entwickler will ich Geometrie-Regressionstests, damit Änderungen an der Rechnung nichts unbemerkt kaputt machen.

## 6. Funktionale Anforderungen

Priorität nach MoSCoW: **M** = Must, **S** = Should, **C** = Could.

### F1 – Schattenmodell mit Horizontmasken

| ID | Anforderung | Prio |
|----|-------------|------|
| F1.1 | Pro Messpunkt (Terrasse oder Fassadenpunkt) wird eine **Horizontmaske** berechnet: für jeden Azimut-Sektor (z. B. 2°) der maximale Höhenwinkel der Verdeckung. Schatten heißt dann: Sonnenhöhe < Maske[Azimut]. | M |
| F1.2 | Die Maske ist zeitunabhängig und wird einmal berechnet. Jeder Zeitpunkt (Schieber, Timeline) kostet danach nur einen Lookup. | M |
| F1.3 | Die Augenhöhe der sitzenden Person ist als Parameter wählbar (Standard 1,2 m). | S |
| F1.4 | Die bisherige Strahl-Logik (`inShade`) bleibt als Referenz-Implementierung für Tests erhalten. | S |

### F2 – Präzisionsdaten Wien (vorberechnet)

| ID | Anforderung | Prio |
|----|-------------|------|
| F2.1 | Eine Python-Pipeline (GitHub Actions) berechnet die Horizontmasken für alle Wiener Orte aus `wien.json`. | M |
| F2.2 | Gebäudehöhen kommen aus offenen Daten der Stadt Wien (Baukörper- bzw. Gebäudemodell, Lizenz prüfen) mit OSM-Höhen als Fallback. | M |
| F2.3 | Das Gelände (DGM, z. B. Stadt Wien oder basemap.at) fließt in die Horizontmaske ein, für Hanglagen und den fernen Horizont (Wienerwald). | S |
| F2.4 | Die Ausgabe ist eine kompakte statische Datei (z. B. `data/wien-horizon.bin` oder in Kacheln aufgeteilt). Zielgröße ≤ 2 MB gzip, Laden nur bei Bedarf. | M |
| F2.5 | Der Client nutzt vorberechnete Masken, wenn vorhanden, und rechnet sonst selbst (F1). | M |
| F2.6 | Die Pipeline schlägt fehl statt kaputte Daten zu schreiben (wie beim bestehenden Wien-Update). | M |

### F3 – Sonnenminuten und Sortierung

| ID | Anforderung | Prio |
|----|-------------|------|
| F3.1 | Pro Ort werden die Sonnenminuten in einem Fenster ab dem gewählten Zeitpunkt berechnet (Standard 2 h, Schritt 5 min). Geschlossene Zeiten zählen nicht. | M |
| F3.2 | Die Liste ist sortierbar nach „meiste Sonne in den nächsten 2 h“, alternativ nach Entfernung. | M |
| F3.3 | Die Sonnenminuten werden in der Liste kompakt angezeigt (z. B. „☀️ 85 min“). | M |
| F3.4 | Die Fensterlänge ist einstellbar (1 h / 2 h / 4 h). | C |

### F4 – Anonymes Feedback (1-Tap-Votes)

| ID | Anforderung | Prio |
|----|-------------|------|
| F4.1 | Im Popup eines Orts: „Stimmt das gerade?“ mit ☀️ Sonne / ⛅ teils / ☁️ Schatten. | M |
| F4.2 | Gespeichert werden Orts-ID, Messpunkt, Zeitstempel (UTC), Vote, die Modellvorhersage samt Sonnenhöhe und Azimut sowie die Modellversion. | M |
| F4.3 | Kein Login. Eine zufällige Geräte-ID (localStorage) dient nur der Deduplizierung. Rate-Limit: 1 Vote pro Ort und Gerät pro 30 min, global pro IP-Hash. | M |
| F4.4 | Votes sind nur möglich, wenn der Nutzer in der Nähe ist (≤ 150 m, Standort freiwillig) **oder** werden als „nicht vor Ort“ markiert und bei der Auswertung getrennt. | S |
| F4.5 | Export als CSV für die Auswertung (Python oder MATLAB). | M |

### F5 – Validierung und Kalibrierung

| ID | Anforderung | Prio |
|----|-------------|------|
| F5.1 | Unit-Tests mit synthetischen Szenen (Würfel, L-Gebäude, Hang) und bekanntem Schatten | M |
| F5.2 | Ground-Truth-Set: 20–30 Wiener Cafés, zu festen Zeiten selbst geprüft (Foto und Notiz), als Datei im Repo | S |
| F5.3 | Auswerteskript: Trefferquote, Konfusionsmatrix, Fehler nach Tageszeit, Sonnenhöhe und Gebäudehöhenquelle | S |
| F5.4 | Kalibrierbare Parameter (Standardhöhe 15 m, Terrassen-Offset 4 m, Augenhöhe) sind zentral konfiguriert. | M |

### F6 – Bestehende Funktionen (beibehalten)

Karte, Adresssuche, 48-h-Schieber, Filter (geöffnet, nur Sonne, Kategorie), Öffnungszeiten mit Feiertagen, Wetteranzeige, Kettenfilter und der Wien-Datensatz mit Auto-Update.

## 7. Nicht-funktionale Anforderungen

| Bereich | Anforderung |
|---------|-------------|
| Kosten | **0 €.** Nur Free Tiers: Vercel Hobby, GitHub Actions, ein Free-KV/DB-Anbieter für Votes. Kein dauerhaft laufender Server. |
| Latenz | Wien: Ergebnis in < 2 s nach Ortswahl. Weltweit: < 6 s (abhängig von Overpass). Kein Cold Start über 3 s im kritischen Pfad. |
| Robustheit | Jede externe Quelle (Overpass, Nominatim, Open-Meteo, Votes-API) darf ausfallen, ohne dass die Hauptansicht bricht. |
| Datenschutz | Keine personenbezogenen Daten speichern. IP nur gesalzen gehasht fürs Rate-Limit, nicht dauerhaft. Kein Tracking. Hinweis im Info-Dialog. |
| Wartbarkeit | ES-Module ohne Build-Zwang. Reine Rechenfunktionen ohne DOM, damit sie testbar sind. CI läuft bei jedem Push. |
| Lizenzen | OSM (ODbL) und Open Government Data Wien (Attribution) korrekt ausweisen |
| Rate-Limits | Nominatim ≤ 1 req/s (besteht). Overpass nur über Cache und Proxy. |

## 8. Erfolgskriterien

Nutzerzahlen sind bewusst **kein** Kriterium.

| Kriterium | Ziel |
|-----------|------|
| Trefferquote Sonne/Schatten (Wien, Ground Truth) | ≥ 85 % (Baseline vorher messen) |
| Trefferquote weltweit (Stichprobe) | Baseline dokumentieren, keine Verschlechterung |
| Testabdeckung der Rechenmodule (`shade`, `horizon`, `sunminutes`) | ≥ 80 % Zeilen |
| CI | Grün auf `main`, Lint und Tests bei jedem Push |
| Doku | README, Architekturdiagramm, Methodik-Seite („Wie wird gerechnet?“) |
| Kosten | 0 € pro Monat |

## 9. Architektur-Entscheidung

**Frage:** Soll die Schattenrechnung live auf einem Server laufen (Option 2) oder vorberechnet mit Client-Fallback (Option 3)?

**Entscheidung: Option 3. Wien vorberechnet, weltweit im Client, Vercel Functions nur für schlanke APIs.**

Begründung:

- **Live-Server kostenlos geht nur mit Abstrichen.** Render Free hat Cold Starts von 30–50 s, das war schon einmal der Grund für den Abbruch. Vercel- und Cloudflare-Functions starten schnell, haben aber knappe Limits für Bundle-Größe, Laufzeit und CPU. Ein Gebäude- und Geländemodell für Wien passt dort nicht sinnvoll hinein, und weltweit fehlen die Präzisionsdaten ohnehin.
- **Horizontmasken machen Vorberechnung billig.** Sie sind zeitunabhängig. Ein Lauf in GitHub Actions deckt alle Zeitpunkte des Jahres ab, und Nachberechnen ist nur bei Datenänderungen nötig.
- **Der Client bleibt der Fallback.** Er ist bewährt und funktioniert weltweit ohne Server.

Zielarchitektur:

```
GitHub Actions (Python, cron)          Vercel (statisch + Functions)          Browser
┌──────────────────────────┐          ┌──────────────────────────┐         ┌───────────────────────────┐
│ OSM-Orte (Overpass)      │──json──▶ │ data/wien.json           │──────▶  │ Horizontmaske vorhanden?  │
│ Gebäudemodell Wien + DGM │          │ data/wien-horizon.*      │──────▶  │  ja  → Lookup             │
│ → Horizontmasken         │          │                          │         │  nein→ aus Kachel-Gebäuden│
└──────────────────────────┘          │ api/overpass.js (Cache)  │◀──────  │        selbst berechnen   │
                                      │ api/vote.js ──▶ Free KV  │◀──────  │ Sonnenminuten, Sortierung │
                                      └──────────────────────────┘         └───────────────────────────┘
```

- **Pipeline:** Python (numpy, shapely, rasterio bzw. pyproj). Das passt zum Data-Science-Hintergrund und läuft kostenlos in GitHub Actions.
- **Votes:** Vercel Function plus Free-Tier-KV/DB (Kandidaten: Upstash Redis, Cloudflare D1, Turso). Achtung: Supabase Free pausiert Projekte bei Inaktivität, das ist bei geringer Nutzung ungünstig. Die Limits vor der Wahl prüfen.
- **Altes `backend/`:** wird **gelöscht**. Der Prototyp bleibt in der Git-History. Die neue Pipeline startet sauber unter `pipeline/`.

## 10. Datenquellen

| Zweck | Quelle | Status |
|-------|--------|--------|
| Orte, Öffnungszeiten, Terrassen | OpenStreetMap / Overpass | besteht |
| Gebäude weltweit | OpenFreeMap-Vektorkacheln (`render_height`) | besteht |
| Gebäudehöhen Wien | Stadt Wien Open Data (Baukörper- bzw. Gebäudemodell) | **neu**, Format und Lizenz klären |
| Gelände | DGM Stadt Wien oder basemap.at (Österreich) | **neu**, Auflösung wählen (≤ 10 m) |
| Sonnenstand | SunCalc (Client), gleiche Formeln in Python (z. B. `pvlib` oder `astral`) | besteht / neu |
| Wetter | Open-Meteo | besteht (nur Anzeige) |

## 11. Risiken

| Risiko | Auswirkung | Gegenmaßnahme |
|--------|------------|---------------|
| Wiener Gebäudedaten schwer zu verarbeiten (Format, CRS, Größe) | Phase 2 verzögert sich | Spike zuerst: kleinen Ausschnitt (1. Bezirk) verarbeiten, danach skalieren |
| Horizontmasken-Datei zu groß | Langsames Laden | Sektorbreite erhöhen, als uint8 quantisieren, in Kacheln aufteilen und lazy laden |
| Kaum Votes wegen geringer Nutzung | Kalibrierung dünn | Eigenes Ground-Truth-Set (F5.2) als Hauptquelle, Votes ergänzend |
| Spam oder Missbrauch der Vote-API | Daten verfälscht | Rate-Limit, Feld „nicht vor Ort“, Ausreißer-Filter bei der Auswertung |
| Free-Tier-Bedingungen ändern sich | Kosten oder Ausfall | Votes-Speicher hinter kleinem Adapter. Notfalls Votes deaktivieren, die App bleibt nutzbar. |
| Client- und Pipeline-Rechnung weichen voneinander ab | Inkonsistente Ergebnisse | Gemeinsame Test-Fixtures (gleiche Szenen in JS- und Python-Tests) |

## 12. Offene Fragen

1. ~~Welcher Wiener Gebäudedatensatz wird genutzt?~~ Geklärt in [SPIKE-2.1](SPIKE-2.1.md): Baukörpermodell der Flächen-Mehrzweckkarte (LoD0.4), CC BY 4.0.
2. Welche DGM-Auflösung ist für den Horizont nötig? Die Gebäude bringen ihre Geländehöhe mit, siehe [SPIKE-2.1](SPIKE-2.1.md). Die Auflösung für den Geländehorizont klärt Aufgabe 2.4.
3. Welcher Free-KV für Votes? Entscheidung beim Start von Phase 3 nach aktuellem Free-Tier-Vergleich.
4. Bekommen Bars und Restaurants im Wien-Datensatz auch Horizontmasken? Das wären rund 5.100 statt rund 1.900 Orte, und die Datei würde entsprechend größer.
