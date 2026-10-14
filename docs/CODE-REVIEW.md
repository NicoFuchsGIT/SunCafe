# Code-Review bis Phase 3.5 und D1.7

Stand: Tests 93/93 grün (`npm test`), ESLint sauber, `pytest pipeline` 14/14 grün.

## Mittel

1. **Vote-Fehlermeldung wird nie angezeigt** (`js/ui.js`, `voteBox`). Nach jedem Ergebnis ruft der Handler `openPopup()` auf und baut den Inhalt neu. Danach schreibt er `box.lastChild.textContent = t('vote.error')` in die schon ersetzte Box. Bei `error` sieht man also nur frisch aktivierte Knöpfe ohne Hinweis. Fix: Meldung in `voteMsg` ablegen (z. B. `'vote.error'`) und beim Neuaufbau anzeigen, Knöpfe aktiv lassen.
2. **Emojis als Bedienelemente** (`js/ui.js`: ☀️ ⛅ ☁️ auf den Vote-Knöpfen). Widerspricht dem Ziel von D1.5/„Fertig, wenn“ von D1. Durch Sprite-Icons ersetzen (`i-sun`, `i-partial`, `i-shade` existieren teils noch nicht im Sprite in `index.html`; dort sind nur sun, pin, route, chevron definiert, die übrigen Icons aus D1.5 fehlen).
3. **Vote-Zeitstempel veraltet** (`js/ui.js`). Die Nutzlast wird beim Öffnen des Popups gebaut, die API akzeptiert nur ±10 min. Wer länger wartet, bekommt 400 → „Senden fehlgeschlagen“. Fix: `t`/Sonnenstand erst beim Klick bauen.
4. **Rebuild während des Sendens** (`update()` ruft `openPopup()` auf): Während `checkOnSite` (bis 8 s) oder dem Request wird das Popup neu gebaut, die Knöpfe sind wieder aktiv. Doppelklick ergibt dann 429 („schon bewertet“) trotz erfolgreichem ersten Vote. Fix: Status „sendet“ in `voteMsg` halten.
5. **Overpass-Proxy cached auch Fehlerantworten** (`api/overpass.js`). Overpass antwortet bei Überlast oft mit HTTP 200 und `remark`/leeren `elements`. Das wird 1 h im CDN gehalten. Fix: nur cachen, wenn `elements` vorhanden und kein `remark` mit „runtime error“.

## Niedrig

6. **Rate-Limit nicht atomar** (`api/_lib/storage.js`, `incrWithTtl`): `INCR` und `EXPIRE` getrennt. Scheitert `EXPIRE`, bleibt der Zähler dauerhaft und sperrt Gerät/IP. Besser per Pipeline/`SET NX EX` + `INCR` oder Lua.
7. **Fallback-IP `unknown`** (`api/vote.js`): Fehlt jeder IP-Header, teilen sich alle ein Limit (60/h). Auf Vercel nicht relevant, nur zur Kenntnis.
8. **Kein Origin-Check bei `/api/vote`**: Jeder kann Votes posten. Durch Rate-Limit begrenzt, `predicted` ist unverifizierbar. Für die Kalibrierung `onSite` und Modellversion getrennt auswerten.
9. **Export lädt die ganze Liste** (`LRANGE 0 -1`). Bei sehr vielen Votes Antwortgröße/Zeit beachten (später paginieren).
10. **Akkumulierte Cafés** (`setPlace`): Beim Ortswechsel werden Cafés nur hinzugefügt, nie entfernt. Die Zählung „n von total“ und die Karte enthalten dann auch weit entfernte Orte; Speicher wächst.
11. **Geocode ohne Rückmeldung** (`js/data.js`): Enter binnen 1,1 s nach der letzten Anfrage wird stillschweigend ignoriert.
12. **`fetchWeather` prüft `r.ok` nicht**; funktioniert nur, weil der TypeError im Aufrufer gefangen wird. Open-Meteo-Parameter selbst sind in Ordnung (`forecast_days=3` deckt die 48 h des Schiebers, Zeit als Unix-Zeit, `timezone=auto`).
13. **Sicherheits-Header fehlen** (`vercel.json`): kein CSP, `X-Content-Type-Options`, `Referrer-Policy`. Mit selbst gehosteten Skripten ist eine strenge CSP gut machbar (MapLibre braucht `worker-src blob:`).
14. **Cloudflare-Konfiguration** (`wrangler.jsonc`): Es gibt dort kein `/api`, Votes und Overpass-Proxy gingen ins Leere. `404.html` wird ohne `not_found_handling: "404-page"` nicht ausgeliefert. Entweder entfernen oder dokumentieren, dass produktiv nur Vercel gilt.
15. **`404.html`** nutzt absolute Pfade (`/favicon.svg`, `/`), `index.html` relative. Auf einem Unterpfad (GitHub Pages) kaputt. Sonst in Ordnung (D1.7: Favicon vorhanden, 404 zweisprachig).

## Datenschutz (Phase 3.5, eigener Fehler, schon behoben)

Der erste Entwurf behauptete, der Standort werde „nur im Browser verwendet“. Tatsächlich gehen gerundete Koordinaten an Overpass/Nominatim, Open-Meteo und Vercel. Der Text in `js/i18n.js` (DE/EN) nennt das jetzt.

## Testlücken

- Ohne Tests: `js/ui.js` (komplett), `js/data.js` (`parseCafes`, `fetchCafes`-Turbo und Fallback, `geocode`), `js/hours.js` (`openInfo`, `wall`).
- Vorschlag: `parseCafes` (Kettenfilter, Terrassenzuordnung, ptype), `openInfo` (offen/geschlossen/unklar, Zeitzone), `fetchCafes` mit gemocktem `fetch` (Wien-Turbo → Fallback bei kaputter Datei), ein Playwright-Smoke-Test für Popup + Vote (Fehlerpfad aus Punkt 1).
- API: Test für `overpass.js` existiert; ein Test für „200 mit `remark`“ fehlt (Punkt 5). `storage.incrWithTtl` hat keinen Test für fehlgeschlagenes `EXPIRE`.

## Positiv

- Geometrie in DOM-freien Modulen, JS/Python teilen Fixtures, Äquivalenztest Strahl vs. Maske.
- Votes: Whitelist der Felder, kein Freitext, Roh-IP und Roh-Geräte-ID werden nicht gespeichert, Fail-closed ohne Salt/Storage, Export mit Timing-sicherem Tokenvergleich und `no-store`.
- Overpass-Proxy baut die Abfrage selbst (kein offener Proxy). Render über `textContent`, `innerHTML` nur mit festen Texten.
- Keine Anfragen an Google/jsDelivr (D1.4 erfüllt); Vendor-Versionen passen zu `package.json`.
