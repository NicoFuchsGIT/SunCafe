#!/usr/bin/env python3
"""Auswertung des Ground-Truth-Sets: python3 validation/auswertung.py [groundtruth.csv]

Zeilen ohne `vorhersage` werden übersprungen (noch nicht mit dem Modell verglichen).
"""
import csv
import sys
from collections import Counter, defaultdict

KLASSEN = ["sonne", "teils", "schatten"]


def lies(pfad):
    with open(pfad, newline="", encoding="utf-8") as f:
        return [r for r in csv.DictReader(f) if r.get("vorhersage", "").strip()]


def sonnenhoehe(r):
    h = float(r["sonnenhoehe"])
    return "<15°" if h < 15 else "15–30°" if h < 30 else "30–45°" if h < 45 else "≥45°"


def tageszeit(r):
    h = int(r["uhrzeit"].split(":")[0])
    return "vor 12 Uhr" if h < 12 else "12–15 Uhr" if h < 15 else "ab 15 Uhr"


def gruppen(rows, schluessel):
    g = defaultdict(lambda: [0, 0])
    for r in rows:
        k = schluessel(r)
        g[k][0] += r["beobachtung"] == r["vorhersage"]
        g[k][1] += 1
    return dict(sorted(g.items()))


def bericht(rows):
    if not rows:
        return "Keine Zeilen mit Vorhersage."
    out = []
    treffer = sum(r["beobachtung"] == r["vorhersage"] for r in rows)
    out.append(f"Trefferquote: {treffer}/{len(rows)} = {100 * treffer / len(rows):.1f} %")
    z = Counter((r["beobachtung"], r["vorhersage"]) for r in rows)
    out.append("\nKonfusionsmatrix (Zeilen: beobachtet, Spalten: vorhergesagt)")
    out.append(f"{'':10}" + "".join(f"{k:>10}" for k in KLASSEN))
    for b in KLASSEN:
        out.append(f"{b:10}" + "".join(f"{z[(b, v)]:>10}" for v in KLASSEN))
    for titel, f in [("Sonnenhöhe", sonnenhoehe), ("Tageszeit", tageszeit),
                     ("Höhenquelle", lambda r: r["hoehenquelle"] or "?")]:
        out.append(f"\nTrefferquote nach {titel}")
        for k, (t, n) in gruppen(rows, f).items():
            out.append(f"  {k:12} {t}/{n} = {100 * t / n:.0f} %")
    return "\n".join(out)


if __name__ == "__main__":
    print(bericht(lies(sys.argv[1] if len(sys.argv) > 1 else "validation/groundtruth.csv")))
