import csv
import auswertung


def test_bericht(tmp_path):
    p = tmp_path / "g.csv"
    with open(p, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["beobachtung", "vorhersage", "sonnenhoehe", "uhrzeit", "hoehenquelle"])
        w.writerow(["sonne", "sonne", "50", "13:00", "wien"])
        w.writerow(["schatten", "sonne", "10", "16:30", "osm"])
        w.writerow(["teils", "", "20", "10:00", "osm"])  # ohne Vorhersage: übersprungen
    rows = auswertung.lies(p)
    assert len(rows) == 2
    out = auswertung.bericht(rows)
    assert "1/2 = 50.0 %" in out
    assert "ab 15 Uhr    0/1 = 0 %" in out
    assert auswertung.bericht([]).startswith("Keine")
