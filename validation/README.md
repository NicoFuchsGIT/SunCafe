# Ground-Truth-Set (Phase 4.1)

`groundtruth.csv`: eigene Vor-Ort-Prüfungen, Ziel 20–30 Wiener Cafés zu verschiedenen Tages- und Jahreszeiten. Eine Zeile pro Beobachtung. Nur echte Beobachtungen eintragen.

| Spalte | Inhalt |
|--------|--------|
| `osm_id` | `id` des Ortes in `data/wien.json` |
| `name`, `lat`, `lon` | wie in `wien.json` |
| `datum`, `uhrzeit` | Ortszeit Wien, `YYYY-MM-DD`, `HH:MM` |
| `ort` | `terrasse` oder `fassade` (wie vom Modell gemessen) |
| `beobachtung` | `sonne`, `teils` oder `schatten` |
| `foto` | Dateiname unter `validation/fotos/` (optional) |
| `notiz` | z. B. Wolken, Schirme, Bäume |

Pro Café mindestens zwei Zeitpunkte (z. B. Vormittag und Nachmittag); über das Jahr verteilt. Auswertung folgt in 4.2.
