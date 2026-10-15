# SunCafe – Design-Roadmap (Mobile, Sprache, Bedienung)

Läuft parallel zur [Feature-Roadmap](ROADMAP.md) und ersetzt deren Phase 5 („UX/UI und PWA“) im Umfang, nicht im Zeitpunkt. Die Datenphasen (Wien-Präzision, Feedback, Validierung) bleiben dort.

Entstanden aus einem Design-Review (Oktober 2026). Kapazität und Budget wie in der Feature-Roadmap: 3–8 h pro Woche, 0 €.

**Arbeitsweise:** ein Branch und ein Pull Request pro Schritt (`design/d1-fundament`, `design/d2-mobile` …). Jeder Schritt endet mit einem deployten, benutzbaren Stand.

---

## Leitentscheidungen

| # | Entscheidung | Grund |
|---|--------------|-------|
| E1 | **Mobile first**, Desktop zweitrangig. Beide Layouts werden überarbeitet. | Hauptfall: unterwegs, einhändig, Sonne auf dem Display |
| E2 | Zielgruppe: Wiener und Touristen, am Schreibtisch planen ist der Nebenfall | |
| E3 | Einstieg ist die **Karte mit Zeitschieber**. Café antippen öffnet unten ein Sheet. Liste und Filter hinter eigenen Knöpfen, Filter zusammengefasst. | Antwort „Wo ist Sonne?“ ohne Scrollen |
| E4 | Zeitschieber bleibt, wird größer, Schnellwahl darüber (Jetzt · +1 h · Heute Abend · Morgen) | |
| E5 | **Route** per Deep Link mit Koordinaten (Google und Apple Maps, kostenlos, kein API-Key) als großer Button im Café-Sheet | Heutiges 🗺️ führt nur zu einer Namenssuche |
| E6 | Sprachen: **Deutsch und Englisch**, automatisch nach `navigator.language`, Umschalter im Info-Dialog | Touristen, mehr Sprachen erst bei Bedarf |
| E7 | Standort abgelehnt oder nicht verfügbar: App **fragt nach dem Ort**, kein stiller Fallback | Stiller Fallback liefert falsche Ergebnisse unbemerkt |
| E8 | Außerhalb Wiens: **einmal pro Sitzung** Hinweis „Berechnung ungenauer“ | Dort 15 m Standardhöhe, kein Fernhorizont |
| E9 | Emojis werden durch **SVG-Icons** ersetzt. Logo wird separat entwickelt. | Einheitliche Optik, Screenreader, kein Gerätevergleich |
| E10 | Font **Bricolage Grotesque selbst hosten** (OFL), Bibliotheken ebenfalls | Weniger Fremdserver, Ladezeit, Datenschutz |
| E11 | **Dark Mode** richtet sich nach der eingestellten Zeit (Sonnenstand am Ort, ist bereits so umgesetzt). Echter dunkler Kartenstil statt Invertier-Filter. | Filter verfälscht das Sonnen-Gelb |
| E12 | Symbole tragen die Information, Farbe ergänzt sie | Kontrast in Sonne, Farbsehschwäche |
| E13 | Offline: zwischengespeicherter Stand mit Zeitstempel, sonst „Kein Netz“ | |
| E14 | **Attribution bleibt Pflicht** (OSM, Stadt Wien, DGM, OpenFreeMap), kurz und gut auffindbar. Die lange Methodik darf gekürzt werden. | CC BY und ODbL verlangen sie |
| E15 | Feedback bei falschen Ergebnissen: Link zu einem GitHub-Issue, später durch die Votes aus Phase 3 ersetzt | |

---

## Messwerte vor dem Umbau (Mobile-Emulation, 390×844, Stephansplatz)

| Netz | Erste Cafés | Fertig |
|------|-------------|--------|
| 4G | 6,5 s | 7,5 s |
| langsames 3G | 16,8 s | 20,8 s |

Rund 2,5 MB in 39 Requests ohne Kompression (eigene Dateien 1,8 MB, Kartenkacheln 340 KB, jsDelivr 310 KB, Google Fonts 42 KB). Auf Vercel mit gzip realistisch ca. 1 MB. Die Wartezeit hängt an den vielen nacheinander laufenden Requests. Nach D4 erneut messen.

Offene Messpunkte: ein 404 beim Laden (vermutlich Favicon) und eine Open-Meteo-Anfrage ohne erkennbare Antwortgröße.

---

## D1 – Fundament (ca. 14 h · Branch `design/d1-fundament`)

Ziel: Das Layout ist noch unverändert, aber alles, worauf der Umbau aufbaut, steht.

| # | Aufgabe | Aufwand |
|---|---------|---------|
| D1.1 | `js/i18n.js`: Wörterbuch DE/EN, Funktion `t(key)`, Sprachwahl, Formate (Uhrzeit, Entfernung) über die Sprache statt fest `de-AT`. Alle Texte aus `index.html`, `ui.js`, `hours.js` überführen. | 5 h |
| D1.2 | Test: Beide Sprachen haben dieselben Schlüssel | 1 h |
| D1.3 | Font als WOFF2 (lateinisches Subset, variabel) nach `fonts/`, `@font-face` mit `font-display: swap`, OFL-Lizenz ins Repo | 1 h |
| D1.4 | MapLibre, SunCalc, opening_hours selbst hosten (feste Versionen, wie in `package.json`) | 2 h |
| D1.5 | SVG-Icon-Satz (Sonne, Teils-Sonne, Schatten, Nacht, Café, Bar, Restaurant, Pin, Route, Filter, Liste, Standort) als Sprite, Emojis in UI und Dropdowns ersetzen (Stand: Sprite komplett; im Einsatz sind Vote-Knöpfe, Pin, Route, Chevron und `i-list` am Listen-Knopf. `i-night`, `i-cafe`, `i-bar`, `i-restaurant`, `i-filter`, `i-locate` sind definiert und warten auf das neue Layout ab D2) | 3 h |
| D1.6 | Attribution kurz am Kartenrand, Info-Dialog zweisprachig und gekürzt, Link „Ergebnis falsch?“ zum GitHub-Issue | 1,5 h |
| D1.7 | Favicon, 404 und Open-Meteo-Anfrage prüfen | 0,5 h |

**Fertig, wenn:** Die App läuft in DE und EN, lädt keine Dateien mehr von Google oder jsDelivr, zeigt keine Emojis als Bedienelemente und alle Tests sind grün.

---

## D2 – Mobile-Umbau (ca. 24 h · Branch `design/d2-mobile`)

Ziel: Die App ist unterwegs einhändig bedienbar.

| # | Aufgabe | Aufwand |
|---|---------|---------|
| D2.1 | Layout: Karte im Vollbild, schmales Suchfeld oben, großer Standort-Button, Zeitschieber unten. Raster mit 46/54-Teilung entfällt. | 5 h |
| D2.2 | Café-Sheet unten beim Antippen: Name, Sonnenstatus, Sonnenminuten, Öffnungszeiten, Button **Route (zu Fuß)** mit Koordinaten. Popup ersetzt. | 5 h |
| D2.3 | Listen-Knopf: Vollbildliste oder nur Schieber (zwei Zustände, wie besprochen) | 3 h |
| D2.4 | Filter-Knopf: „Geöffnet“, „Nur Sonne“, Kategorie, Sortierung in einem Panel, Anzahl aktiver Filter am Knopf. Platz für weitere Filter. | 3 h |
| D2.5 | Zeitschieber: größer, Schnellwahl-Chips, Schrittanzeige beim Ziehen, Hinweis „Vorschau“ bei Abweichung von jetzt | 3 h |
| D2.6 | Marker mit Symbolen und dunklem Rand (Sonne, Teils, Schatten, Nacht, geschlossen), Kontrast mindestens 3:1 | 2 h |
| D2.7 | Standortfluss: abgelehnt oder Zeitüberschreitung führt zur Frage „Wo bist du?“ mit Suchfeld, Hinweis außerhalb Wiens (E8) | 2 h |
| D2.8 | Tap-Ziele mindestens 44 px, `--mute`-Kontrast prüfen, Fokus und Tastatur, `aria`-Beschriftung der neuen Elemente | 1 h |

**Stand:** D2.1 bis D2.8 sind im Code umgesetzt und mit Playwright-Mobile-Emulation (iPhone 14, 390 × 844) und Desktop-Ansicht geprüft (`npm run test:e2e`). Entscheidungen dabei:
- Standard-Sortierung ist „Meiste Sonne“ bis 800 m, weiter entfernte Orte folgen nach Entfernung.
- Chip „Abend“ = eine Stunde vor Sonnenuntergang (entfällt danach), „Morgen früh“ = zwei Stunden nach Sonnenaufgang.
- Mobil ist die Liste ein Vollbild-Overlay, am Desktop bleibt sie als Spalte links.
- Standort wird sofort abgefragt; bei Ablehnung, Fehler oder erfolgloser Adresssuche öffnet sich „Wo bist du?“ (Adresse, erneut versuchen, auf der Karte wählen, Wien Zentrum). Es gibt keinen stillen Wien-Fallback mehr.
- Zoom-Knöpfe und der Pin-Knopf der Karte gibt es nur am Desktop; mobil erreicht man „Auf der Karte wählen“ über den Dialog.
- Route: Google Maps, auf Apple-Geräten Apple Karten mit Google Maps als zweiter Link.
- Wetterzeile sitzt unter dem Suchfeld.

**Noch offen:** Test auf einem echten iPhone und Android-Gerät. Im Dunkelmodus werden die Marker mit der Karte invertiert (gehört zu D3).

**Fertig, wenn:** Auf einem Handy führen höchstens zwei Taps von der geöffneten App zur Route. Test mit Playwright-Mobile-Emulation und mindestens einem echten Gerät.

---

## D3 – Dark Mode und Ladeverhalten (ca. 12 h · Branch `design/d3-dunkel-laden`)

| # | Aufgabe | Aufwand |
|---|---------|---------|
| D3.1 | Dunkler Kartenstil statt `invert(1) hue-rotate(180deg)`. Prüfen, ob OpenFreeMap einen passenden Stil liefert. | 3 h |
| D3.2 | Schaltschwelle prüfen (heute Sonne unter dem Horizont, eventuell Dämmerung bei −6°) und Hinweis „Vorschau: Nacht“, wenn der Schieber die Oberfläche umschaltet | 1 h |
| D3.3 | Farben für beide Modi nachmessen (Kontrast, Marker, Sheet) | 1 h |
| D3.4 | Platzhalter statt leerem Bildschirm: Karte und graue Marker sofort, Färbung folgt | 3 h |
| D3.5 | Abhängigkeiten parallel starten (Position, Wetter, Kacheln, Horizont), Reihenfolge im Code prüfen | 3 h |
| D3.6 | Messung wiederholen: Ziel auf 4G erste Cafés unter 3 s | 1 h |

**Fertig, wenn:** Dark Mode zeigt keine Farbverfälschung, und die Messung ist dokumentiert.

---

## D4 – Logo, PWA und Offline (ca. 10 h · Branch `design/d4-pwa`)

Voraussetzung: Logo liegt vor.

| # | Aufgabe | Aufwand |
|---|---------|---------|
| D4.1 | Logo als SVG, Icons (192, 512, maskable), `manifest.webmanifest` (Name, Farben, `standalone`) | 2 h |
| D4.2 | Service Worker: App-Gerüst, `wien.json`, Horizont, Font zwischenspeichern; versionierter Cache, der bei jedem Datenupdate (`update-wien.yml`) mitwechselt | 3 h |
| D4.3 | Kartenkacheln: nur zuletzt gesehene behalten, keine Vollkopie von Wien | 1 h |
| D4.4 | Offline-Anzeige „Stand 14:32“ bzw. „Kein Netz“ | 2 h |
| D4.5 | Hinweis „Zum Homescreen hinzufügen“ für iOS, einmalig | 1 h |
| D4.6 | Test: Installation Android und iOS, Update-Verhalten (alter Cache wird ersetzt) | 1 h |

**Fertig, wenn:** Die App lässt sich installieren, der zweite Start liegt deutlich unter dem ersten, und ein Update erreicht installierte Nutzer.

---

## Offene Punkte

| Punkt | Notiz |
|-------|-------|
| Standard-Sortierung | Entschieden: Sonne zuerst, Obergrenze 800 m (`SORT_SUN_MAX_M`). |
| Weitere Filter | Terrasse, Hunde erlaubt, Barrierefreiheit, Steckdosen; hängt von OSM-Tags ab, Datenlage vorher prüfen |
| Echtes Gerät | Mindestens ein iPhone und ein Android-Gerät für D2 und D4 |
| Logo | Zeitplan offen, blockiert nur D4 |
| Feedback-Weg | GitHub-Issue (E15), später Votes aus Phase 3 der Feature-Roadmap |
| Methodik-Text | Zweisprachig kurz oder nur Deutsch lang? Entscheiden in D1.6 |

---

## Zusammenspiel mit der Feature-Roadmap

- D1 und D2 können sofort starten, sie berühren die Rechenmodule nicht.
- Phase 3 (Votes) baut ihre UI in das Café-Sheet aus D2.2, nicht mehr ins Popup. Bis D2 fertig ist, bleibt Phase 3 zurückgestellt oder nutzt das alte Popup.
- Phase 5 der Feature-Roadmap entfällt zugunsten dieser Datei. Die Sonnen-Timeline pro Café und „Beste Stunde“ kommen nach D2 in das Sheet.
