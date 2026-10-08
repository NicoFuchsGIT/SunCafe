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
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
_cache = {}
CACHE_TTL = 600  # 10 Minuten


class OverpassRequest(BaseModel):
    query: str


@app.post("/api/overpass")
def overpass_proxy(req: OverpassRequest):
    cached = _cache.get(req.query)
    if cached and time.time() - cached[0] < CACHE_TTL:
        return cached[1]

    last_error = None
    for url in OVERPASS_ENDPOINTS:
        try:
            r = requests.post(
                url,
                data={"data": req.query},
                headers={"User-Agent": "SunCafe/1.0"},
                timeout=30,
            )
            r.raise_for_status()
            data = r.json()
            _cache[req.query] = (time.time(), data)
            return data
        except Exception as e:
            last_error = e
            print(f"Overpass-Fehler bei {url}: {e}")

    raise HTTPException(status_code=502, detail=f"Overpass nicht erreichbar: {last_error}")

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