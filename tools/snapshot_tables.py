#!/usr/bin/env python3
"""Take a snapshot of the real records the gym's judgment questions are built from.

The question builder (tools/make_questions.py) never goes online: it reads the CSV files this script writes into
data/question_tables/. So the bank is the same on every machine, and every number in it can be traced to a file in
the repository. Run this only when you want to refresh or extend the records (it needs network access, and
`pip install vega_datasets`), then run tools/make_questions.py and commit the result.

What it writes (and where each record comes from is in data/question_tables/sources.csv):
  seattle_weather.csv   daily weather in Seattle, 2012 to 2015 (NOAA, public domain), 1,461 days
  flights.csv           20,000 US domestic flights, January to March 2001 (US Bureau of Transportation Statistics)
  airports.csv          city names for the airports in flights.csv (OurAirports, public domain)
  sp500_shiller.csv     monthly S&P 500 price and price level, 1949 to 2022 (Robert Shiller's long-run data)
  owid_<indicator>.csv  six long-run indicators by country, every fifth year from 1990 to 2020, where a country has the figure (Our World in Data)

Python 3 standard library, plus vega_datasets for the weather, flights and airports files.
"""
import csv
import hashlib
import io
import json
import os
import ssl
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "data", "question_tables")
UA = "predict-question-builder/1.0 (a one-off data snapshot for a free calibration game)"
ANCHORS = [1990, 1995, 2000, 2005, 2010, 2015, 2020]
MIN_POPULATION = 2_000_000  # leave out micro-states: their series are noisy and a player cannot reason about them
# slug on ourworldindata.org/grapher -> (file name, column in the OWID csv we keep, decimals kept)
OWID = {
    "life-expectancy": ("owid_life_expectancy.csv", 4),
    "child-mortality-igme": ("owid_child_mortality.csv", 4),
    "co-emissions-per-capita": ("owid_co2_per_person.csv", 4),
    "gdp-per-capita-worldbank": ("owid_gdp_per_person.csv", 1),
    "share-electricity-renewables": ("owid_renewables_share.csv", 3),
    "children-per-woman-un": ("owid_fertility.csv", 3),
}


def fetch(url):
    cafile = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
    ctx = ssl.create_default_context(cafile=cafile) if cafile and os.path.exists(cafile) else ssl.create_default_context()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, context=ctx, timeout=120) as r:
        return r.read()


def write(name, header, rows):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    blob = open(path, "rb").read()
    print(f"wrote {name}: {len(rows)} rows, sha256 {hashlib.sha256(blob).hexdigest()[:12]}")


def weather_flights_airports():
    from vega_datasets import data
    w = data.seattle_weather()
    write("seattle_weather.csv", ["date", "precip_mm", "temp_max_c", "temp_min_c"],
          [[d.strftime("%Y-%m-%d"), f"{p:g}", f"{hi:g}", f"{lo:g}"] for d, p, hi, lo in zip(w.date, w.precipitation, w.temp_max, w.temp_min)])
    f = data.flights_20k()
    write("flights.csv", ["row", "departs", "origin", "destination", "distance_mi", "arrival_delay_min"],
          [[i + 1, d.strftime("%Y-%m-%d %H:%M"), o, t, int(mi), int(dl)] for i, (d, dl, mi, o, t) in enumerate(zip(f.date, f.delay, f.distance, f.origin, f.destination))])
    used = set(f.origin) | set(f.destination)
    a = data.airports()
    a = a[a.iata.isin(used)].sort_values("iata")
    missing = used - set(a.iata)
    if missing:
        sys.exit(f"airports.csv is missing {sorted(missing)}")
    write("airports.csv", ["iata", "city", "state"], [[r.iata, r.city, r.state] for r in a.itertuples()])


def shiller():
    text = fetch("https://raw.githubusercontent.com/datasets/s-and-p-500/main/data/data.csv").decode("utf-8")
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        d = r["Date"]
        if "1949-12" <= d[:7] <= "2022-12" and float(r["Consumer Price Index"]) > 0:
            rows.append([d[:7], f"{float(r['SP500']):.2f}", r["Consumer Price Index"], f"{float(r['Real Price']):.2f}"])
    write("sp500_shiller.csv", ["month", "price", "cpi", "real_price"], rows)


def owid():
    pop = {}
    for r in csv.DictReader(io.StringIO(fetch("https://ourworldindata.org/grapher/population.csv?v=1&csvType=full&useColumnShortNames=false").decode("utf-8"))):
        if r["Year"] == "2020" and r["Code"] and not r["Code"].startswith(("OWID_", "UN_")):
            pop[r["Code"]] = int(float(r["Population"]))
    for slug, (name, dec) in OWID.items():
        text = fetch(f"https://ourworldindata.org/grapher/{slug}.csv?v=1&csvType=full&useColumnShortNames=false").decode("utf-8")
        rd = csv.reader(io.StringIO(text))
        head = next(rd)
        by = {}
        for row in rd:
            ent, code, year, val = row[0], row[1], row[2], row[3]
            if not code or code.startswith(("OWID_", "UN_")) or int(year) not in ANCHORS or val == "":
                continue
            if pop.get(code, 0) < MIN_POPULATION:
                continue
            by.setdefault((ent, code), {})[int(year)] = float(val)
        rows = []
        for (ent, code), series in sorted(by.items()):
            for y in ANCHORS:  # a year a country has no figure for is simply absent; a window needs all three of its years
                if y in series:
                    text_value = f"{series[y]:.{dec}f}"
                    rows.append([code, ent, y, text_value.rstrip("0").rstrip(".") if "." in text_value else text_value])
        write(name, ["code", "country", "year", "value"], rows)
        print(f"   {slug}: column '{head[3]}', {len({r[0] for r in rows})} countries")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    weather_flights_airports()
    shiller()
    owid()
