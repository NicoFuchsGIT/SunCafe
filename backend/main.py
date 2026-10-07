import math
import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from astral import LocationInfo
from astral.sun import azimuth as get_azimuth, elevation as get_elevation
from datetime import datetime, timezone, timedelta
from shapely.geometry import Point, LineString, Polygon

app = FastAPI(title="SunCafe API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Liste der unerwünschten Ketten (alles in Kleinbuchstaben für den Filter)
UNERWUENSCHTE_KETTEN = ["der mann", "aida", "felber", "ströck", "stroeck", "anker", "unbekannt"]


@app.get("/api/sun_cafes")
def get_sun_cafes(lat: float = 48.2082, lon: float = 16.3738, radius: int = 400):
    observer = LocationInfo(name="Current", region="Local", timezone="UTC", latitude=lat, longitude=lon).observer

    # Zeitpunkte definieren: Jetzt, in 1h, in 2h
    now_utc = datetime.now(timezone.utc)
    # TIPP: Für einen Tag-Test kannst du hier wieder eine feste Zeit eintragen
    # now_utc = datetime(2026, 10, 8, 14, 0, tzinfo=timezone.utc)

    zeitpunkte = {
        "jetzt": now_utc,
        "in_1h": now_utc + timedelta(hours=1),
        "in_2h": now_utc + timedelta(hours=2)
    }

    # Sonnenposition für alle 3 Zeitpunkte berechnen
    sonnen_daten = {}
    for label, zeit in zeitpunkte.items():
        el = get_elevation(observer, zeit)
        az = get_azimuth(observer, zeit)
        sonnen_daten[label] = {"elevation": el, "azimut": az, "ist_tag": el > 0}

    overpass_url = "https://lz4.overpass-api.de/api/interpreter"
    overpass_query = f"""
        [out:json][timeout:25];
        (
          node["amenity"="cafe"](around:{radius},{lat},{lon});
          node["shop"="bakery"](around:{radius},{lat},{lon});
          way["building"](around:{radius},{lat},{lon});
        );
        out geom;
        """

    # Der "Ausweis": Overpass blockiert Render nicht mehr, wenn das nach einem echten Projekt aussieht
    headers = {
        "User-Agent": "SunCafeApp/1.0 (Student Project FH; contact: hello@suncafe.app)"
    }

    overpass_servers = [
        "https://lz4.overpass-api.de/api/interpreter",
        "https://z.overpass-api.de/api/interpreter",
        "https://overpass-api.de/api/interpreter"
    ]

    data = None
    for url in overpass_servers:
        try:
            # Das Timeout auf 25 Sekunden erhöht, da Cloud-Anfragen manchmal etwas länger dauern
            response = requests.post(url, data=overpass_query, headers=headers, timeout=25)
            response.raise_for_status()
            data = response.json()
            break
        except Exception as e:
            # Gibt den Fehler im Render-Log aus, falls wir doch mal debuggen müssen
            print(f"Fehler bei {url}: {e}")
            continue

    if not data:
        return {"status": "Fehler", "nachricht": "Alle Overpass-Server sind aktuell überlastet."}

    cafes = []
    buildings = []

    for element in data.get("elements", []):
        tags = element.get("tags", {})

        if element["type"] == "node" and ("cafe" in tags.values() or "bakery" in tags.values()):
            name = tags.get("name", "Unbekannt")

            # FILTER: Ist der Name in der Ausschluss-Liste? Dann überspringen!
            if any(kette in name.lower() for kette in UNERWUENSCHTE_KETTEN):
                continue

            cafes.append({
                "id": element["id"],
                "name": name,
                "lat": element["lat"],
                "lon": element["lon"]
            })

        elif element["type"] == "way" and "building" in tags:
            coords = [(pt["lon"], pt["lat"]) for pt in element.get("geometry", [])]
            if len(coords) >= 3:
                try:
                    height = float(tags.get("height", "15").replace("m", "").strip())
                except ValueError:
                    height = 15.0
                buildings.append({"polygon": Polygon(coords), "height": height})

    meters_per_deg_lat = 111320.0
    meters_per_deg_lon = 40075000.0 * math.cos(math.radians(lat)) / 360.0

    # Ray-Casting für alle 3 Zeitpunkte durchführen
    for cafe in cafes:
        cafe_pt = Point(cafe["lon"], cafe["lat"])
        cafe["vorhersage"] = {}

        for label, sonne in sonnen_daten.items():
            if not sonne["ist_tag"]:
                cafe["vorhersage"][label] = False
                continue

            in_sun = True
            math_angle = 90.0 - sonne["azimut"]
            dx_deg = (500.0 * math.cos(math.radians(math_angle))) / meters_per_deg_lon
            dy_deg = (500.0 * math.sin(math.radians(math_angle))) / meters_per_deg_lat

            ray = LineString([cafe_pt, Point(cafe["lon"] + dx_deg, cafe["lat"] + dy_deg)])

            for bldg in buildings:
                if bldg["polygon"].contains(cafe_pt):
                    continue

                if ray.intersects(bldg["polygon"]):
                    intersection = ray.intersection(bldg["polygon"])
                    dist_deg = cafe_pt.distance(intersection)
                    dist_m = dist_deg * ((meters_per_deg_lat + meters_per_deg_lon) / 2.0)
                    shadow_len = bldg["height"] / math.tan(math.radians(sonne["elevation"]))

                    if shadow_len > dist_m:
                        in_sun = False
                        break

            cafe["vorhersage"][label] = in_sun

        # Für das Frontend die aktuelle Farbe beibehalten
        cafe["in_sun"] = cafe["vorhersage"]["jetzt"]

    return {
        "status": "Erfolgreich",
        "gefundene_cafes": len(cafes),
        "cafes": cafes
    }