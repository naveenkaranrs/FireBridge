#!/usr/bin/env python3
"""
FireBridge - NASA FIRMS Archive & NRT Ingestion Pipeline
NASA Space Apps Challenge 2026

Downloads active fire hotspot observations for designated AOIs from the official
NASA FIRMS REST API conforming to EOSDIS / LANCE protocols.

Supported Products:
  - MODIS_NRT / MODIS_SP: Terra & Aqua MOD14/MYD14 Collection 6.1 (1km)
  - VIIRS_SNPP_NRT / VIIRS_SNPP_SP: Suomi-NPP VNP14IMG 375m
  - VIIRS_NOAA20_NRT: NOAA-20 (JPSS-1) VJ114IMG 375m
  - VIIRS_NOAA21_NRT: NOAA-21 (JPSS-2) VJ214IMG 375m

Usage:
  python download_firms.py --aoi california --days 10
  python download_firms.py --aoi punjab --key YOUR_NASA_MAP_KEY
"""

import os
import sys
import argparse
import urllib.request
import urllib.error
from pathlib import Path

# Preset Areas of Interest (Bounding Box: [West, South, East, North])
PRESET_AOIS = {
    "california": {
        "name": "Northern California / Sierra Nevada",
        "bbox": [-124.5, 36.5, -119.0, 42.0],
        "default_source": "VIIRS_SNPP_NRT"
    },
    "punjab": {
        "name": "Punjab & Haryana Agricultural Fire Belt",
        "bbox": [73.5, 29.5, 77.5, 32.5],
        "default_source": "VIIRS_SNPP_NRT"
    },
    "australia": {
        "name": "Southeastern Australia (Black Summer Zone)",
        "bbox": [145.0, -39.0, 153.5, -28.0],
        "default_source": "VIIRS_SNPP_NRT"
    }
}

VALID_SOURCES = [
    "MODIS_NRT",
    "MODIS_SP",
    "VIIRS_SNPP_NRT",
    "VIIRS_SNPP_SP",
    "VIIRS_NOAA20_NRT",
    "VIIRS_NOAA21_NRT"
]

def load_env_key():
    """Reads MAP_KEY from local .env or system environment."""
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("#") or not line:
                    continue
                if "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    if k in ["MAP_KEY", "NASA_FIRMS_MAP_KEY", "FIRMS_MAP_KEY"]:
                        return v
    return os.environ.get("MAP_KEY") or os.environ.get("NASA_FIRMS_MAP_KEY")

def download_firms_area(map_key, source, bbox, days=10, date_str=None, output_dir="pipeline/raw"):
    """
    Queries the NASA FIRMS REST API for a bounding box.
    URL Format:
      https://firms.modaps.eosdis.nasa.gov/api/area/csv/[MAP_KEY]/[SOURCE]/[W,S,E,N]/[DAYS]/[DATE]
    """
    west, south, east, north = bbox
    bbox_str = f"{west},{south},{east},{north}"
    
    date_part = f"/{date_str}" if date_str else ""
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{map_key}/{source}/{bbox_str}/{days}{date_part}"
    
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    out_filename = Path(output_dir) / f"firms_{source}_{west}_{south}_{east}_{north}_{days}d.csv"
    
    print(f"[*] Querying NASA FIRMS API: {source} across [{bbox_str}] for {days} days...")
    print(f"    URL: https://firms.modaps.eosdis.nasa.gov/api/area/csv/[KEY]/{source}/{bbox_str}/{days}")

    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "FireBridge-NASA-SpaceApps-2026/1.0"}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            content = resp.read().decode("utf-8")
            
            if "Invalid MAP_KEY" in content:
                print("[-] Error: NASA FIRMS rejected the MAP_KEY. Obtain a free key at https://firms.modaps.eosdis.nasa.gov/api/map_key/", file=sys.stderr)
                return None
            
            if "Bad Request" in content or "Error" in content and len(content) < 200:
                print(f"[-] API error: {content.strip()}", file=sys.stderr)
                return None
            
            lines = content.strip().splitlines()
            row_count = len(lines) - 1 if len(lines) > 0 else 0
            
            with open(out_filename, "w", encoding="utf-8") as f:
                f.write(content)
            
            print(f"[+] Download complete: {row_count} records saved to {out_filename}")
            return out_filename
            
    except urllib.error.URLError as e:
        print(f"[-] Network connection error: {e}", file=sys.stderr)
        return None

def main():
    parser = argparse.ArgumentParser(description="Download NASA FIRMS Active Fire Observations")
    parser.add_argument("--aoi", choices=list(PRESET_AOIS.keys()), default="california", help="Preset Area of Interest")
    parser.add_argument("--source", choices=VALID_SOURCES, default="VIIRS_SNPP_NRT", help="FIRMS sensor product")
    parser.add_argument("--days", type=int, default=10, help="Days range (1-10 for NRT API)")
    parser.add_argument("--key", type=str, default=None, help="NASA FIRMS MAP_KEY (defaults to .env)")
    parser.add_argument("--date", type=str, default=None, help="Start date (YYYY-MM-DD)")
    args = parser.parse_args()

    key = args.key or load_env_key()
    if not key:
        print("[!] No MAP_KEY found in .env or arguments.")
        print("    Get your free key at: https://firms.modaps.eosdis.nasa.gov/api/map_key/")
        print("    You can create a .env file with: MAP_KEY=your_key_here")
        return

    aoi_info = PRESET_AOIS[args.aoi]
    download_firms_area(key, args.source, aoi_info["bbox"], days=args.days, date_str=args.date)

if __name__ == "__main__":
    main()
