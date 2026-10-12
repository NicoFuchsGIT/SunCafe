# SunCafe

Zeigt Cafés und Bäckereien in der Nähe und schätzt, ob dort gerade Sonne oder Schatten ist (Gebäudeschatten, Vorschau bis 48 h), inklusive Öffnungszeiten.

Funktioniert weltweit; für Wien liegt ein vorab geladener Datensatz bei, der die Abfrage beschleunigt.

Quellcode: https://github.com/NicoFuchsGIT/SunCafe

## Aufbau

```
index.html        Gerüst und Einbindung der Bibliotheken
css/style.css     Styles
js/app.js         Logik (Karte, Daten, Schattenrechnung, Anzeige)
api/overpass.js   Vercel-Funktion: fragt Overpass serverseitig (mit Cache)
data/wien.json    vorab geladene Cafés/Terrassen im Umkreis von 5 km um den Stephansplatz
.github/workflows/update-wien.yml   aktualisiert data/wien.json am 1. und 15. jedes Monats
backend/          altes Python-Backend (Render), wird nicht mehr verwendet
```

## Datenquellen

- Karte: OpenFreeMap (Vektorkacheln, ohne Schlüssel); Gebäude für die Schattenrechnung stammen aus diesen Kacheln
- Cafés und Öffnungszeiten: OpenStreetMap über die Overpass-API (in Wien aus `data/wien.json`)
- Adresssuche und Land/Bundesland für die Feiertage: Nominatim (höchstens 1 Anfrage pro Sekunde, Ergebnis wird lokal gespeichert)
- Wetter und Zeitzone des Orts: Open-Meteo
- Sonnenstand: SunCalc, Öffnungszeiten: opening_hours.js

Daten © OpenStreetMap contributors (ODbL).

## Hinweise

- Nach einer Änderung an `style.css` oder `app.js` die Zahl hinter `?v=` in `index.html` erhöhen, damit Browser die neue Datei laden.
- Uhrzeit und Öffnungsstatus richten sich nach der Ortszeit des gewählten Orts, nicht nach der Zeitzone des Browsers.
- Feiertage (`PH` in den Öffnungszeiten) gelten für Land und Bundesland des Orts. Ist das Land nicht ermittelbar, werden solche Öffnungszeiten als unbekannt angezeigt.
- Ketten (Liste `BAD_CHAINS` in `app.js`) werden ausgeblendet, verglichen wird auf ganze Wörter.
- Gebäude ohne Höhenangabe in OpenStreetMap werden pauschal mit 15 m angesetzt, das Ergebnis ist eine Näherung.