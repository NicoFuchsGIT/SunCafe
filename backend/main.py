import math
import time
import requests
from fastapi import HTTPException
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any
from astral import LocationInfo
from astral.sun import azimuth as get_azimuth, elevation as get_elevation
from datetime import datetime, timezone, timedelta
from shapely.geometry import Point, LineString, Polygon

app = FastAPI(title="SunCafe API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://suncafe-nu.vercel.app"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Das Modell für die Daten, die wir vom Frontend empfangen
class GeoData(BaseModel):
    lat: float
    lon: float
    cafes: List[Dict[str, Any]]
    buildings: List[Dict[str, Any]]

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
]
_cache = {}
CACHE_TTL = 600


@app.post("/api/overpass")
def overpass_proxy(req: OverpassRequest):
    cached = _cache.get(req.query)
    if cached and time.time() - cached[0] < CACHE_TTL:
        return cached[1]

    errors = []
    for attempt in range(2):  # zwei Durchläufe über alle Server
        for url in OVERPASS_ENDPOINTS:
            try:
                r = requests.post(
                    url,
                    data={"data": req.query},
                    headers={"User-Agent": "SunCafe/1.0 (https://suncafe-nu.vercel.app)"},
                    timeout=30,
                )
                if r.status_code == 200:
                    data = r.json()
                    _cache[req.query] = (time.time(), data)
                    return data
                errors.append(f"{url}: HTTP {r.status_code}")
                print(f"Overpass {url}: HTTP {r.status_code} {r.text[:200]}")
            except Exception as e:
                errors.append(f"{url}: {type(e).__name__}")
                print(f"Overpass {url}: {e}")
        time.sleep(2)

    raise HTTPException(status_code=502, detail=" | ".join(errors))

# Aus @app.get wird @app.post, weil wir jetzt ein Datenpaket vom Frontend empfangen!
@app.post("/api/calculate_shadows")
def calculate_shadows(data: GeoData):
    lat = data.lat
    lon = data.lon

    observer = LocationInfo(name="Current", region="Local", timezone="UTC", latitude=lat, longitude=lon).observer
    now_utc = datetime.now(timezone.utc)

    zeitpunkte = {
        "jetzt": now_utc,
        "in_1h": now_utc + timedelta(hours=1),
        "in_2h": now_utc + timedelta(hours=2)
    }

    sonnen_daten = {}
    for label, zeit in zeitpunkte.items():
        el = get_elevation(observer, zeit)
        az = get_azimuth(observer, zeit)
        sonnen_daten[label] = {"elevation": el, "azimut": az, "ist_tag": el > 0}

    # Gebäude für Shapely vorbereiten
    shapely_buildings = []
    for bldg in data.buildings:
        if len(bldg["coords"]) >= 3:
            poly = Polygon(bldg["coords"])
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.is_empty:
                continue
            shapely_buildings.append({"polygon": poly, "height": bldg["height"]})

    meters_per_deg_lat = 111320.0
    meters_per_deg_lon = 40075000.0 * math.cos(math.radians(lat)) / 360.0

    # Ray-Casting durchführen
    for cafe in data.cafes:
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

            for bldg in shapely_buildings:
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

        cafe["in_sun"] = cafe["vorhersage"]["jetzt"]

    return {
        "status": "Erfolgreich",
        "cafes": data.cafes
    }