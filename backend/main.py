import math
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from astral import LocationInfo
from astral.sun import azimuth as get_azimuth, elevation as get_elevation
from shapely.geometry import Point, LineString, Polygon

app = FastAPI(title="SunCafe API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://suncafe-nu.vercel.app"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class GeoData(BaseModel):
    lat: float
    lon: float
    cafes: List[Dict[str, Any]]
    buildings: List[Dict[str, Any]]


@app.get("/")
def health():
    return {"status": "ok"}


@app.post("/api/calculate_shadows")
def calculate_shadows(data: GeoData):
    lat0, lon0 = data.lat, data.lon

    # Lokale Projektion: Grad -> Meter relativ zum Nutzerstandort
    m_per_deg_lat = 111320.0
    m_per_deg_lon = 40075000.0 * math.cos(math.radians(lat0)) / 360.0

    def to_xy(lon, lat):
        return ((lon - lon0) * m_per_deg_lon, (lat - lat0) * m_per_deg_lat)

    observer = LocationInfo(
        name="Current", region="Local", timezone="UTC",
        latitude=lat0, longitude=lon0
    ).observer
    now_utc = datetime.now(timezone.utc)

    zeitpunkte = {
        "jetzt": now_utc,
        "in_1h": now_utc + timedelta(hours=1),
        "in_2h": now_utc + timedelta(hours=2),
    }

    sonnen_daten = {}
    for label, zeit in zeitpunkte.items():
        el = get_elevation(observer, zeit)
        az = get_azimuth(observer, zeit)
        sonnen_daten[label] = {"elevation": el, "azimut": az, "ist_tag": el > 0}

    # Gebäude in Meter-Koordinaten, ungültige Polygone reparieren
    shapely_buildings = []
    for bldg in data.buildings:
        try:
            coords = bldg.get("coords", [])
            if len(coords) < 3:
                continue
            poly = Polygon([to_xy(c[0], c[1]) for c in coords])
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.is_empty:
                continue
            shapely_buildings.append({
                "polygon": poly,
                "height": float(bldg.get("height", 15.0)),
            })
        except Exception as e:
            print("Gebäude übersprungen:", e)

    # Ray-Casting
    for cafe in data.cafes:
        cx, cy = to_xy(cafe["lon"], cafe["lat"])
        cafe_pt = Point(cx, cy)
        cafe["vorhersage"] = {}

        for label, sonne in sonnen_daten.items():
            if not sonne["ist_tag"]:
                cafe["vorhersage"][label] = False
                continue

            in_sun = True
            az_rad = math.radians(sonne["azimut"])
            # Azimut: 0° = Nord, im Uhrzeigersinn -> Richtung zur Sonne
            dx = 500.0 * math.sin(az_rad)
            dy = 500.0 * math.cos(az_rad)
            ray = LineString([(cx, cy), (cx + dx, cy + dy)])

            tan_el = math.tan(math.radians(max(sonne["elevation"], 0.5)))

            for bldg in shapely_buildings:
                poly = bldg["polygon"]
                # Café liegt im Gebäude (OSM-Node): dieses Gebäude ignorieren
                if poly.contains(cafe_pt):
                    continue
                if ray.intersects(poly):
                    dist_m = cafe_pt.distance(ray.intersection(poly))
                    shadow_len = bldg["height"] / tan_el
                    if shadow_len > dist_m:
                        in_sun = False
                        break

            cafe["vorhersage"][label] = in_sun

        cafe["in_sun"] = cafe["vorhersage"]["jetzt"]

    return {"status": "Erfolgreich", "cafes": data.cafes}