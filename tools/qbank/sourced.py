"""Questions built from the tables in data/question_tables/. Every row there names the page it was read from, and every
question made from it carries that page as its source link. Claims are kept clear of near ties: a comparison needs a
real gap, and a threshold sits well away from the printed figure, so two sources that differ by a few metres or a few
hundred square kilometres still agree on the answer."""
import datetime
import itertools
import math

from common import BANK_DATE, add, both, claim_pair, lc_first, margin_diff, ratio_diff, read, rng_for

MINUS = "−"


def src(url, name):
    return dict(source=url, src_name=name, checked=BANK_DATE)


def thr_claim(group, key, text_gt, text_lt, value, thr, fact, why, domain, diff=None, **s):
    """'more than' and 'less than' statements about one figure and one threshold."""
    assert value != thr
    claim_pair(group, key, text_gt, text_lt, value > thr, fact, why, domain, diff or margin_diff((value - thr) / value), "sourced", **s)


def pair_claim(group, key, text_a_over_b, text_b_over_a, va, vb, fact, why, domain, diff=None, **s):
    assert va != vb
    claim_pair(group, key, text_a_over_b, text_b_over_a, va > vb, fact, why, domain, diff or ratio_diff(va / vb), "sourced", **s)


THE = {"Netherlands", "United Kingdom", "United States", "Democratic Republic of the Congo", "Central African Republic"}


def C(name, start=False):
    """A country's name with its article where English wants one."""
    return (("The " if start else "the ") + name) if name in THE else name


def ordinal(n):
    return {1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", 6: "sixth", 7: "seventh", 8: "eighth", 9: "ninth", 10: "tenth", 11: "eleventh", 12: "twelfth", 13: "thirteenth", 14: "fourteenth"}[n]


# ---------------------------------------------------------------- planets (NASA Planetary Fact Sheet)
NASA = src("https://nssdc.gsfc.nasa.gov/planetary/factsheet/", "NASA Planetary Fact Sheet")


def planets():
    P = {r["planet"]: r for r in read("planets.csv")}
    num = lambda pl, col: float(P[pl][col])

    def show(pl, col):
        r = P[pl][col]
        x = float(r)
        if col == "diameter_km": return f"{int(x):,} km"
        if col == "mass_1e24kg": return f"{r} × 10^24 kg"
        if col == "density_kgm3": return f"{int(x):,} kg/m³"
        if col == "gravity_ms2": return f"{r} m/s²"
        if col == "day_hours": return f"{r} hours"
        if col == "sun_dist_1e6km": return f"{r} million km"
        if col == "orbit_days": return f"{int(x):,} days" if x == int(x) and x > 1000 else f"{r} days"
        if col == "mean_temp_c": return f"{r.replace('-', MINUS)} °C"
        raise KeyError(col)

    label = {"diameter_km": "Diameter", "mass_1e24kg": "Mass", "density_kgm3": "Density", "gravity_ms2": "Surface gravity", "day_hours": "Length of day", "mean_temp_c": "Mean temperature"}
    said = {
        "diameter_km": lambda a, b: f"{a} is wider than {b}.",
        "mass_1e24kg": lambda a, b: f"{a} has more mass than {b}.",
        "density_kgm3": lambda a, b: f"{a} is denser than {b}.",
        "gravity_ms2": lambda a, b: f"Surface gravity is stronger on {a} than on {b}.",
        "day_hours": lambda a, b: f"A day on {a} is longer than a day on {b}.",
        "mean_temp_c": lambda a, b: f"{a} is hotter than {b}, on average.",
    }

    def duel(col, a, b, why="", diff=None):
        va, vb = num(a, col), num(b, col)
        x, y = sorted([a, b])
        text = lambda p, q: said[col](p, q)
        if col == "mean_temp_c":
            d = abs(va - vb)
            diff = diff or ("easy" if d >= 150 else "medium" if d >= 50 else "hard")
        pair_claim("planet", f"{col}:{x}:{y}", text(x, y), text(y, x), num(x, col), num(y, col),
                   f"{label[col]}: {x} {show(x, col)}, {y} {show(y, col)}.", why, "science", diff, **NASA)

    allp = list(P)
    rng = rng_for("planet")
    for col, count in (("diameter_km", 5), ("mass_1e24kg", 4), ("density_kgm3", 3), ("gravity_ms2", 3), ("day_hours", 3)):
        allowed = [p for p in allp if not (col == "day_hours" and p in ("Mercury", "Venus"))]
        pairs = [(a, b) for a, b in itertools.combinations(allowed, 2) if max(num(a, col), num(b, col)) / min(num(a, col), num(b, col)) >= 1.15]
        for a, b in rng.sample(pairs, count):
            duel(col, a, b)
    # Close calls and surprises, read straight off the table.
    duel("mean_temp_c", "Venus", "Mercury", "Venus is farther from the Sun (108.2 million km against 57.9) and still hotter.")
    duel("mean_temp_c", "Earth", "Mars")
    duel("gravity_ms2", "Neptune", "Earth", "The table gives 11.0 against 9.8: a much bigger planet, a modestly stronger pull.", "hard")
    duel("gravity_ms2", "Saturn", "Earth", "Saturn is far bigger than Earth, and its listed surface gravity is lower.", "hard")
    duel("density_kgm3", "Mercury", "Venus", "", "hard")
    duel("density_kgm3", "Neptune", "Uranus", "", "medium")
    duel("day_hours", "Uranus", "Neptune", "", "hard")
    duel("day_hours", "Mars", "Earth", "", "hard")
    duel("diameter_km", "Earth", "Venus", "Venus is nearly Earth's twin in size: 12,104 km against 12,756.", "hard")
    duel("diameter_km", "Neptune", "Uranus", "", "hard")

    def same_gravity():
        both("planet", "same_g", "To the precision NASA lists, Mars and Mercury have the same surface gravity.", "To the precision NASA lists, Mars and Mercury have different surface gravity.",
             "Both are listed at 3.7 m/s².", "Both are listed at 3.7 m/s², so they match.", "Mars is almost twice as wide as Mercury, and the pull at the surface is still the same.", "science", "hard", "sourced", **NASA)
    same_gravity()
    claim_pair("planet", "densest", "Earth is the densest of the eight planets.", "Mercury is the densest of the eight planets.", True,
               "Earth is listed at 5,514 kg/m³ and Mercury at 5,429.", "Mercury is much smaller, but its density is only 1.5% lower.", "science", "hard", "sourced", **NASA)
    claim_pair("planet", "shortest_day", "Jupiter has the shortest day of the eight planets.", "Saturn has the shortest day of the eight planets.", True,
               "Jupiter's day is 9.9 hours and Saturn's is 10.7.", "", "science", "hard", "sourced", **NASA)
    thr_claim("planet", "saturn_density", "Saturn's average density is above 1,000 kg/m³.", "Saturn's average density is below 1,000 kg/m³.", 687, 1000,
              "The table lists Saturn at 687 kg/m³.", "That is less dense than water, which is about 1,000 kg/m³.", "science", "medium", **NASA)

    # Ratios to Earth. text_gt is the 'more than' statement, text_lt the 'less than' one.
    def ratio(key, pl, col, thr, text_gt, text_lt, why=""):
        base = num("Earth", col)
        r = num(pl, col) / base
        thr_claim("planet", f"{key}", text_gt, text_lt, r, thr,
                  f"{label.get(col, col)}: {pl} {show(pl, col)}, Earth {show('Earth', col)}, a ratio of {r:.2f}.", why, "science", **NASA)

    ratio("jd", "Jupiter", "diameter_km", 10, "Jupiter is more than 10 times as wide as Earth.", "Jupiter is less than 10 times as wide as Earth.")
    ratio("sd", "Saturn", "diameter_km", 10, "Saturn is more than 10 times as wide as Earth.", "Saturn is less than 10 times as wide as Earth.")
    ratio("nd", "Neptune", "diameter_km", 4, "Neptune is more than 4 times as wide as Earth.", "Neptune is less than 4 times as wide as Earth.")
    ratio("md", "Mars", "diameter_km", 0.5, "Mars is more than half as wide as Earth.", "Mars is less than half as wide as Earth.")
    ratio("jm", "Jupiter", "mass_1e24kg", 300, "Jupiter has more than 300 times the mass of Earth.", "Jupiter has less than 300 times the mass of Earth.")
    ratio("sm", "Saturn", "mass_1e24kg", 100, "Saturn has more than 100 times the mass of Earth.", "Saturn has less than 100 times the mass of Earth.")
    ratio("mm", "Mars", "mass_1e24kg", 0.1, "Mars has more than a tenth of the mass of Earth.", "Mars has less than a tenth of the mass of Earth.")
    ratio("um", "Uranus", "mass_1e24kg", 15, "Uranus has more than 15 times the mass of Earth.", "Uranus has less than 15 times the mass of Earth.")
    ratio("jg", "Jupiter", "gravity_ms2", 2, "Surface gravity on Jupiter is more than twice Earth's.", "Surface gravity on Jupiter is less than twice Earth's.")
    ratio("mg", "Mars", "gravity_ms2", 1 / 3, "Surface gravity on Mars is more than a third of Earth's.", "Surface gravity on Mars is less than a third of Earth's.")
    ratio("jday", "Jupiter", "day_hours", 0.5, "A day on Jupiter is longer than half an Earth day.", "A day on Jupiter is shorter than half an Earth day.")
    ratio("jsun", "Jupiter", "sun_dist_1e6km", 5, "Jupiter is more than 5 times as far from the Sun as Earth.", "Jupiter is less than 5 times as far from the Sun as Earth.")
    ratio("ssun", "Saturn", "sun_dist_1e6km", 10, "Saturn is more than 10 times as far from the Sun as Earth.", "Saturn is less than 10 times as far from the Sun as Earth.")
    ratio("nsun", "Neptune", "sun_dist_1e6km", 25, "Neptune is more than 25 times as far from the Sun as Earth.", "Neptune is less than 25 times as far from the Sun as Earth.")
    ratio("msun", "Mars", "sun_dist_1e6km", 1.4, "Mars is more than 1.4 times as far from the Sun as Earth.", "Mars is less than 1.4 times as far from the Sun as Earth.")
    ratio("jyr", "Jupiter", "orbit_days", 10, "One year on Jupiter lasts longer than 10 Earth years.", "One year on Jupiter lasts less than 10 Earth years.")
    ratio("nyr", "Neptune", "orbit_days", 200, "One year on Neptune lasts longer than 200 Earth years.", "One year on Neptune lasts less than 200 Earth years.")
    ratio("uyr", "Uranus", "orbit_days", 100, "One year on Uranus lasts longer than 100 Earth years.", "One year on Uranus lasts less than 100 Earth years.")
    ratio("myr", "Mars", "orbit_days", 2, "One year on Mars lasts longer than 2 Earth years.", "One year on Mars lasts less than 2 Earth years.")

    for key, pl, t, text_gt, text_lt in (
        ("t_mars", "Mars", -50, f"The mean temperature of Mars is above {MINUS}50 °C.", f"The mean temperature of Mars is below {MINUS}50 °C."),
        ("t_venus", "Venus", 400, "The mean temperature of Venus is above 400 °C.", "The mean temperature of Venus is below 400 °C."),
        ("t_earth", "Earth", 20, "The mean temperature of Earth is above 20 °C.", "The mean temperature of Earth is below 20 °C."),
        ("t_mercury", "Mercury", 200, "The mean temperature of Mercury is above 200 °C.", "The mean temperature of Mercury is below 200 °C."),
    ):
        v = num(pl, "mean_temp_c")
        d = abs(v - t)
        thr_claim("planet", key, text_gt, text_lt, v, t, f"The table lists {pl} at {show(pl, 'mean_temp_c')}.", "", "science",
                  "easy" if d >= 50 else "medium" if d >= 25 else "hard", **NASA)

    # Light travel time from the Sun: the table's distance over the speed of light (299,792.458 km/s, exact).
    c = 299792.458
    for key, pl, minutes, text_gt, text_lt in (
        ("lt_earth", "Earth", 10, "Sunlight takes more than 10 minutes to reach Earth.", "Sunlight takes less than 10 minutes to reach Earth."),
        ("lt_jupiter", "Jupiter", 30, "Sunlight takes more than 30 minutes to reach Jupiter.", "Sunlight takes less than 30 minutes to reach Jupiter."),
        ("lt_neptune4", "Neptune", 240, "Sunlight takes more than 4 hours to reach Neptune.", "Sunlight takes less than 4 hours to reach Neptune."),
        ("lt_neptune5", "Neptune", 300, "Sunlight takes more than 5 hours to reach Neptune.", "Sunlight takes less than 5 hours to reach Neptune."),
        ("lt_mars", "Mars", 12, "Sunlight takes more than 12 minutes to reach Mars.", "Sunlight takes less than 12 minutes to reach Mars."),
        ("lt_saturn", "Saturn", 60, "Sunlight takes more than an hour to reach Saturn.", "Sunlight takes less than an hour to reach Saturn."),
    ):
        mins = num(pl, "sun_dist_1e6km") * 1e6 / c / 60
        thr_claim("planet", key, text_gt, text_lt, mins, minutes, f"{pl} is {show(pl, 'sun_dist_1e6km')} from the Sun, and light covers it in {mins:.1f} minutes ({mins / 60:.2f} hours).",
                  "Light travel time is distance over the speed of light.", "science", **NASA)

    # Fold a 0.1 mm sheet of paper in half again and again.
    sun_m = num("Earth", "sun_dist_1e6km") * 1e9
    f_hi = math.ceil(math.log2(sun_m / 1e-4))
    f_lo = f_hi - 1
    assert 1e-4 * 2 ** f_hi > sun_m > 1e-4 * 2 ** f_lo
    both("planet", "fold", f"Fold a sheet of paper 0.1 mm thick in half {f_hi} times, if that were possible, and the stack would be thicker than the distance from the Earth to the Sun.",
         f"Fold a sheet of paper 0.1 mm thick in half {f_lo} times, if that were possible, and the stack would be thicker than the distance from the Earth to the Sun.",
         f"{f_hi} folds make 0.1 mm × 2^{f_hi} = {1e-4 * 2 ** f_hi / 1e9:,.0f} million km, past Earth's {num('Earth', 'sun_dist_1e6km'):.1f} million km from the Sun.",
         f"{f_lo} folds make 0.1 mm × 2^{f_lo} = {1e-4 * 2 ** f_lo / 1e9:,.0f} million km, short of Earth's {num('Earth', 'sun_dist_1e6km'):.1f} million km from the Sun. It takes {f_hi}.",
         "Doubling beats intuition: 50 folds is far more than most people guess.", "science", "hard", "sourced", **NASA)


# ---------------------------------------------------------------- mountains
def mountains():
    rows = [r for r in read("mountains.csv") if r["use"] == "yes"]
    H = {r["mountain"]: float(r["elevation_m"]) for r in rows}
    page = {r["mountain"]: r["source_page"] for r in rows}
    L = "https://en.wikipedia.org/wiki/List_of_highest_mountains_on_Earth"
    urls = {"List of highest mountains on Earth": L, "Seven Summits": "https://en.wikipedia.org/wiki/Seven_Summits", "Mont Blanc": "https://en.wikipedia.org/wiki/Mont_Blanc",
            "Mount Fuji": "https://en.wikipedia.org/wiki/Mount_Fuji", "Matterhorn": "https://en.wikipedia.org/wiki/Matterhorn", "Ben Nevis": "https://en.wikipedia.org/wiki/Ben_Nevis"}
    S = lambda name: src(urls[page[name]], f"Wikipedia: {page[name]}")
    metres = lambda m: f"{H[m]:,.0f}" if H[m] == int(H[m]) else f"{H[m]:,.2f}"

    for name, t in (("Kilimanjaro", 6000), ("Mont Blanc", 4500), ("Mount Fuji", 4000), ("Ben Nevis", 1500), ("Matterhorn", 4000), ("Aconcagua", 6500),
                    ("Denali", 6000), ("Mount Elbrus", 5500), ("Mount Everest", 9000), ("K2", 8500), ("Mount Kosciuszko", 2500), ("Vinson Massif", 5000)):
        assert abs(H[name] - t) >= 40
        thr_claim("peak", name, f"{name} is higher than {t:,} metres.", f"{name} is lower than {t:,} metres.", H[name], t,
                  f"{name} is {metres(name)} m high.", "", "geography", **S(name))
    rng = rng_for("peak")
    names = sorted(H)
    pairs = [(a, b) for a, b in itertools.combinations(names, 2) if abs(H[a] - H[b]) >= 200 and 1.04 <= max(H[a], H[b]) / min(H[a], H[b])]
    for a, b in rng.sample(pairs, 14):
        pair_claim("peak", f"{a}:{b}", f"{a} is higher than {b}.", f"{b} is higher than {a}.", H[a], H[b],
                   f"{a} is {metres(a)} m and {b} is {metres(b)} m.", "", "geography", **S(a))

    eight = sorted([r for r in rows if r["source_page"] == "List of highest mountains on Earth"], key=lambda r: -float(r["elevation_m"]))
    assert len(eight) == 14
    for i, r in enumerate(eight, start=1):
        if i == 1:
            continue
        name = r["mountain"]
        wrong = i + rng.choice([d for d in (-3, -2, -1, 1, 2, 3) if 2 <= i + d <= 14])
        rank = lambda k: f"{name} is the {ordinal(k)}-highest of the 14 mountains above 8,000 metres."
        both("peak", f"rank:{name}", rank(i), rank(wrong), f"In the list, {name} ({metres(name)} m) ranks {ordinal(i)} of the 14 eight-thousanders.",
             f"{name} ranks {ordinal(i)} of the 14 eight-thousanders, not {ordinal(wrong)}.", "", "geography", "medium" if i <= 3 else "hard", "sourced", **S(name))
    both("peak", "count8000", "Fourteen mountains on Earth rise above 8,000 metres.", "Ten mountains on Earth rise above 8,000 metres.",
         "The list names 14 peaks above 8,000 m, from Everest down to Shishapangma at 8,027 m.", "The list names 14 peaks above 8,000 m, not 10.", "", "geography", "medium", "sourced", **S("K2"))
    thr_claim("peak", "everest_k2", "Mount Everest is more than 200 metres higher than K2.", "Mount Everest is less than 200 metres higher than K2.", H["Mount Everest"] - H["K2"], 200,
              f"Everest is {metres('Mount Everest')} m and K2 is {metres('K2')} m, a gap of {H['Mount Everest'] - H['K2']:,.0f} m.", "", "geography", "medium", **S("K2"))
    claim_pair("peak", "aconcagua", "Aconcagua is the highest mountain outside Asia.", "Denali is the highest mountain outside Asia.", True,
               f"Aconcagua is {metres('Aconcagua')} m. Denali is {metres('Denali')} m.", "", "geography", "medium", "sourced", **S("Aconcagua"))


# ---------------------------------------------------------------- countries and India's states
def countries():
    rows = [r for r in read("countries.csv") if r["use"] == "yes"]
    A = {r["country"]: int(r["area_km2"]) for r in rows}
    s = src("https://en.wikipedia.org/wiki/List_of_countries_and_dependencies_by_area", "Wikipedia: List of countries and dependencies by area")
    rng = rng_for("country")
    names = sorted(A)
    pairs = [(a, b) for a, b in itertools.combinations(names, 2) if 1.12 <= max(A[a], A[b]) / min(A[a], A[b]) <= 40]
    for a, b in rng.sample(pairs, 20):
        pair_claim("country", f"{a}:{b}", f"{C(a, True)} is larger than {C(b)} by total area.", f"{C(b, True)} is larger than {C(a)} by total area.", A[a], A[b],
                   f"{a}: {A[a]:,} km². {b}: {A[b]:,} km².", "", "geography", **s)
    for name, t in (("India", 3_000_000), ("Argentina", 3_000_000), ("Russia", 15_000_000), ("Canada", 9_000_000), ("Australia", 8_000_000), ("Japan", 400_000),
                    ("Germany", 300_000), ("United Kingdom", 250_000), ("Nepal", 140_000), ("Bhutan", 40_000), ("Switzerland", 40_000), ("Singapore", 1_000),
                    ("Brazil", 9_000_000), ("Mexico", 2_500_000), ("Kazakhstan", 3_000_000), ("Italy", 280_000)):
        assert abs(A[name] - t) / A[name] >= 0.02, name
        thr_claim("country", f"thr:{name}", f"{C(name, True)} has a total area of more than {t:,} km².", f"{C(name, True)} has a total area of less than {t:,} km².", A[name], t,
                  f"{name}'s total area is {A[name]:,} km².", "", "geography", **s)
    for rank_name, k in (("India", 7), ("Brazil", 5), ("Australia", 6)):
        wrong = k + rng.choice([-1, 1])
        text = lambda n: f"{rank_name} is the {ordinal(n)}-largest country in the world by total area."
        both("country", f"rank:{rank_name}", text(k), text(wrong), f"By total area, {rank_name} ranks {ordinal(k)} in the list ({A[rank_name]:,} km²).",
             f"By total area, {rank_name} ranks {ordinal(k)}, not {ordinal(wrong)}.", "", "geography", "medium", "sourced", **s)


def states():
    rows = read("india_states.csv")
    s = src("https://en.wikipedia.org/wiki/States_and_union_territories_of_India", "Wikipedia: States and union territories of India")
    area = {r["state"]: int(r["area_km2"]) for r in rows}
    pop = {r["state"]: int(r["population_2011"]) for r in rows}
    rng = rng_for("states")
    names = sorted(area)
    for col, data, unit, text, count in (("area", area, "km²", lambda a, b: f"{a} is larger than {b} by area.", 10), ("pop", pop, "people", lambda a, b: f"{a} had more people than {b} in the 2011 census.", 10)):
        pairs = [(a, b) for a, b in itertools.combinations(names, 2) if 1.12 <= max(data[a], data[b]) / min(data[a], data[b]) <= 30]
        for a, b in rng.sample(pairs, count):
            pair_claim("state", f"{col}:{a}:{b}", text(a, b), text(b, a), data[a], data[b], f"{a}: {data[a]:,} {unit}. {b}: {data[b]:,} {unit}.", "", "geography", **s)

    def extreme(key, true_text, false_text, fact, ffact, diff):
        both("state", key, true_text, false_text, fact, ffact, "", "geography", diff, "sourced", **s)
    extreme("biggest", "Rajasthan is the largest of India's 28 states by area.", "Maharashtra is the largest of India's 28 states by area.", f"Rajasthan: {area['Rajasthan']:,} km². Madhya Pradesh is next at {area['Madhya Pradesh']:,}, then Maharashtra at {area['Maharashtra']:,}.",
            f"Rajasthan is largest at {area['Rajasthan']:,} km². Maharashtra is third at {area['Maharashtra']:,}.", "medium")
    extreme("smallest", "Goa is the smallest of India's 28 states by area.", "Sikkim is the smallest of India's 28 states by area.", f"Goa: {area['Goa']:,} km². Sikkim: {area['Sikkim']:,} km².",
            f"Goa is smallest at {area['Goa']:,} km². Sikkim is next at {area['Sikkim']:,}.", "medium")
    extreme("populous", "Uttar Pradesh was the most populous of India's 28 states in the 2011 census.", "Maharashtra was the most populous of India's 28 states in the 2011 census.",
            f"Uttar Pradesh: {pop['Uttar Pradesh']:,}. Maharashtra: {pop['Maharashtra']:,}.", f"Uttar Pradesh had {pop['Uttar Pradesh']:,} people, Maharashtra {pop['Maharashtra']:,}.", "easy")
    extreme("fewest", "Sikkim had the fewest people of India's 28 states in the 2011 census.", "Goa had the fewest people of India's 28 states in the 2011 census.",
            f"Sikkim: {pop['Sikkim']:,}. Goa: {pop['Goa']:,}.", f"Sikkim had {pop['Sikkim']:,} people, Goa {pop['Goa']:,}.", "medium")
    thr_claim("state", "up200", "Uttar Pradesh had more than 200 million people in the 2011 census.", "Uttar Pradesh had fewer than 200 million people in the 2011 census.", pop["Uttar Pradesh"], 200_000_000,
              f"The 2011 census counted {pop['Uttar Pradesh']:,}: just under 200 million.", "A famous round number, and a near miss.", "geography", "hard", **s)
    thr_claim("state", "bihar100", "Bihar had more than 100 million people in the 2011 census.", "Bihar had fewer than 100 million people in the 2011 census.", pop["Bihar"], 100_000_000,
              f"The 2011 census counted {pop['Bihar']:,}.", "", "geography", "hard", **s)
    thr_claim("state", "kerala_area", "Kerala is larger than 40,000 km² in area.", "Kerala is smaller than 40,000 km² in area.", area["Kerala"], 40_000,
              f"Kerala covers {area['Kerala']:,} km².", "", "geography", "hard", **s)

    # Statehood dates: only states whose formation date is a single clear day.
    dated = [r for r in rows if r["use_date"] == "yes"]
    for r in dated:
        y = int(r["statehood_year"])
        shift = rng.choice([1, 2, 3, 5, 8, 12])
        cands = [y + sh for sh in (shift, -shift) if 1950 <= y + sh <= 2014]
        wrong = rng.choice(cands)
        diff = "hard" if shift <= 2 else "medium" if shift <= 6 else "easy"
        both("state", f"year:{r['state']}", f"{r['state']} became a state in {y}.", f"{r['state']} became a state in {wrong}.",
             f"{r['state']} became a state on {r['statehood_date']}.", f"{r['state']} became a state on {r['statehood_date']}, not in {wrong}.", "", "geography", diff, "sourced", **s)
    for a, b in rng.sample([(a, b) for a, b in itertools.combinations(dated, 2) if abs(int(a["statehood_year"]) - int(b["statehood_year"])) >= 3], 6):
        ya, yb = int(a["statehood_year"]), int(b["statehood_year"])
        first, second = (a, b) if ya < yb else (b, a)
        claim_pair("state", f"order:{a['state']}:{b['state']}", f"{first['state']} became a state before {second['state']}.", f"{second['state']} became a state before {first['state']}.", True,
                   f"{first['state']}: {first['statehood_date']}. {second['state']}: {second['statehood_date']}.", "", "geography", "easy" if abs(ya - yb) >= 15 else "medium", "sourced", **s)
    both("state", "y2000", "Chhattisgarh, Jharkhand and Uttarakhand were all created as states in 2000.", "Chhattisgarh, Jharkhand and Uttarakhand were all created as states in 2004.",
         "Chhattisgarh on 1 November 2000, Uttarakhand on 9 November 2000 and Jharkhand on 15 November 2000.", "All three were created in November 2000.", "", "geography", "medium", "sourced", **s)
    both("state", "same_day", "Arunachal Pradesh and Mizoram became states on the same day.", "Arunachal Pradesh and Sikkim became states on the same day.",
         "Both became states on 20 February 1987.", "Arunachal Pradesh became a state on 20 February 1987, Sikkim on 16 May 1975. Mizoram shares Arunachal's date.", "", "geography", "hard", "sourced", **s)

    wrong_cap = {"Madhya Pradesh": "Indore", "Kerala": "Kochi", "Gujarat": "Ahmedabad", "Karnataka": "Mysuru", "Uttar Pradesh": "Kanpur", "Odisha": "Cuttack", "Rajasthan": "Jodhpur",
                 "Bihar": "Gaya", "Chhattisgarh": "Bilaspur", "Jharkhand": "Jamshedpur", "Telangana": "Warangal", "Goa": "Margao", "Nagaland": "Dimapur", "West Bengal": "Siliguri", "Tamil Nadu": "Madurai"}
    caps = {r["state"]: r["capital"] for r in rows if r["use_capital"] == "yes"}
    for st in rng.sample(sorted(wrong_cap), 12):
        both("state", f"cap:{st}", f"{caps[st]} is the capital of {st}.", f"{wrong_cap[st]} is the capital of {st}.",
             f"The capital of {st} is {caps[st]}.", f"The capital of {st} is {caps[st]}, not {wrong_cap[st]}.", "The biggest or best-known city is often not the capital.", "geography", "medium", "sourced", **s)


# ---------------------------------------------------------------- chemical elements
def elements():
    rows = read("elements.csv")
    E = {r["name"]: r for r in rows}
    s = src("https://en.wikipedia.org/wiki/List_of_chemical_elements", "Wikipedia: List of chemical elements")
    sym = {
        "Gold": ("Au", "Ag", "medium"), "Silver": ("Ag", "Si", "medium"), "Iron": ("Fe", "I", "medium"), "Sodium": ("Na", "S", "medium"), "Potassium": ("K", "P", "hard"),
        "Lead": ("Pb", "Pt", "hard"), "Mercury": ("Hg", "Mg", "hard"), "Tin": ("Sn", "Ti", "hard"), "Helium": ("He", "H", "easy"), "Nitrogen": ("N", "Ni", "easy"),
        "Carbon": ("C", "Ca", "easy"), "Calcium": ("Ca", "C", "medium"), "Chlorine": ("Cl", "Cr", "medium"), "Copper": ("Cu", "Co", "medium"), "Magnesium": ("Mg", "Mn", "medium"),
        "Manganese": ("Mn", "Mg", "hard"), "Krypton": ("Kr", "K", "hard"), "Neon": ("Ne", "N", "easy"), "Argon": ("Ar", "As", "medium"), "Platinum": ("Pt", "Pb", "hard"),
    }
    for name, (good, bad, diff) in sym.items():
        assert E[name]["symbol"] == good, name
        both("element", f"sym:{name}", f"The chemical symbol for {name.lower()} is {good}.", f"The chemical symbol for {name.lower()} is {bad}.",
             f"The symbol for {name.lower()} is {good}.", f"The symbol for {name.lower()} is {good}. {bad} stands for {next(r['name'].lower() for r in rows if r['symbol'] == bad)}.",
             "", "science", diff, "sourced", **s)
    rng = rng_for("element")
    for name in ("Carbon", "Oxygen", "Sodium", "Iron", "Copper", "Silver", "Gold", "Lead", "Neon", "Zinc", "Tin", "Silicon", "Chlorine", "Uranium"):
        z = int(E[name]["atomic_number"])
        shift = rng.choice([1, 2, 3, 5, 9, 14, 20])
        wrong = z + shift if z + shift <= 92 and rng.random() < 0.5 or z - shift < 1 else z - shift
        diff = "hard" if shift <= 2 else "medium" if shift <= 9 else "easy"
        both("element", f"z:{name}", f"{name} has atomic number {z}.", f"{name} has atomic number {wrong}.", f"{name} has atomic number {z}.", f"{name} has atomic number {z}, not {wrong}.", "", "science", diff, "sourced", **s)

    def weight(name):
        return float(E[name]["atomic_weight"])
    for key, a, b, why, diff in (("ar_k", "Argon", "Potassium", "Argon comes before potassium in the table (18 and 19) and is still heavier.", "hard"),
                                 ("co_ni", "Cobalt", "Nickel", "Cobalt (27) comes before nickel (28) and is slightly heavier.", "hard"),
                                 ("pb_au", "Lead", "Gold", "", "medium"), ("hg_au", "Mercury", "Gold", "Mercury (80) sits just after gold (79) and is a little heavier.", "hard")):
        pair_claim("element", f"w:{key}", f"{a} has a higher standard atomic weight than {b.lower()}.", f"{b} has a higher standard atomic weight than {a.lower()}.", weight(a), weight(b),
                   f"{a}: {E[a]['atomic_weight']}. {b}: {E[b]['atomic_weight']}.", why, "science", diff, **s)


# ---------------------------------------------------------------- events, Olympics and the World Cup
def events():
    rows = read("events.csv")
    rng = rng_for("events")
    month_names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    # For these a neighbouring year could also be defended, so the false year is kept further away.
    min_shift = {"EV07": 2, "EV33": 2, "EV18": 2, "EV10": 8, "EV24": 3, "EV26": 3}
    when = lambda r: f"{'in' if r['date_as_printed'].isdigit() else 'on'} {r['date_as_printed']}"

    def S(r):
        return src(r["page_url"], f"Wikipedia: {r['page_title']}")
    for r in rows:
        y = int(r["year"])
        fame = r["fame"]
        shifts = {"easy": [6, 8, 10, 12], "medium": [3, 4, 5], "hard": [1, 2]}[fame]
        if r["id"] in min_shift:
            shifts = [s for s in shifts if s >= min_shift[r["id"]]] or [min_shift[r["id"]], min_shift[r["id"]] + 1]
        shift = rng.choice(shifts)
        options = [y + sh for sh in (shift, -shift) if 1900 <= y + sh <= 2026]
        wrong = rng.choice(options)
        both("event", f"year:{r['id']}", f"{r['event']} in {y}.", f"{r['event']} in {wrong}.", f"{r['event']} {when(r)}.",
             f"{r['event']} in {y}, not {wrong}.", "", r["domain"], fame, "sourced", **S(r))
        if r["use_month"] == "yes" and r["id"] in {"EV01", "EV02", "EV08", "EV16", "EV27", "EV28", "EV29", "EV30", "EV32", "EV34", "EV35", "EV12"}:
            m = int(r["month"])
            off = rng.choice([1, 2, 3, 4])
            wm = ((m - 1 + rng.choice([-1, 1]) * off) % 12) + 1
            both("event", f"month:{r['id']}", f"{r['event']} in {month_names[m - 1]} {y}.", f"{r['event']} in {month_names[wm - 1]} {y}.", f"{r['event']} {when(r)}.",
                 f"{r['event']} in {month_names[m - 1]} {y}, not {month_names[wm - 1]}.", "", r["domain"], "hard" if off <= 2 else "medium", "sourced", **S(r))
    # Order of two events.
    ev = [r for r in rows if r["id"] not in {"EV17", "EV20", "EV21"}]
    pairs = [(a, b) for a, b in itertools.combinations(ev, 2) if abs(int(a["year"]) - int(b["year"])) >= 2]
    for a, b in rng.sample(pairs, 26):
        first, second = (a, b) if int(a["year"]) < int(b["year"]) else (b, a)
        gap = int(second["year"]) - int(first["year"])
        claim_pair("event", f"order:{a['id']}:{b['id']}", f"{first['event']} before {lc_first(second['event'])}.", f"{second['event']} before {lc_first(first['event'])}.", True,
                   f"{first['event']} {when(first)}. {second['event']} {when(second)}.", "", first["domain"], "easy" if gap >= 15 else "medium" if gap >= 6 else "hard", "sourced",
                   source=first["page_url"], src_name=f"Wikipedia: {first['page_title']} (and {second['page_title']})", checked=BANK_DATE)
    # Weekday of a dated event.
    for r in rows:
        try:
            d = datetime.datetime.strptime(r["date_as_printed"], "%d %B %Y").date()
        except ValueError:
            continue
        if r["id"] not in {"EV01", "EV02", "EV07", "EV12", "EV28", "EV31", "EV34"}:  # dates that are the same day in every time zone people read them in
            continue
        names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        right = names[d.weekday()]
        wrong = rng.choice([n for n in names if n != right])
        both("evday", r["id"], f"{r['event']} on a {right}.", f"{r['event']} on a {wrong}.", f"{r['date_as_printed']} was a {right}.", f"{r['date_as_printed']} was a {right}, not a {wrong}.",
             "Nobody remembers the weekday, so this is a test of how you handle a pure guess.", r["domain"], "hard", "sourced", **S(r))


def sport():
    rows = read("olympics.csv")
    O = {int(r["year"]): r["host_city"] for r in rows}
    s = src("https://en.wikipedia.org/wiki/List_of_Olympic_Games_host_cities", "Wikipedia: List of Olympic Games host cities")
    rng = rng_for("olympics")
    easy_years, hard_years = {1992, 2008, 2012, 2016, 2024}, {1948, 1952, 1956, 1960, 1972, 1976, 1980, 1984, 1988}
    for y, city in O.items():
        if y == 2020:
            continue
        diff = "easy" if y in easy_years else "hard" if y in hard_years else "medium"
        others = sorted({c for yy, c in O.items() if c != city})
        near = [O[yy] for yy in (y - 4, y + 4) if yy in O and O[yy] != city and yy != 2020]
        wrong = rng.choice(near if diff != "easy" and near else others)
        both("olympics", str(y), f"The {y} Summer Olympics were held in {city}.", f"The {y} Summer Olympics were held in {wrong}.", f"The {y} Summer Games were held in {city}.", f"The {y} Summer Games were held in {city}, not {wrong}.",
             "", "world", diff, "sourced", **s)
    both("olympics", "tokyo2020", "The Tokyo Summer Olympics that carry the name 2020 were held in 2021.", "The Tokyo Summer Olympics that carry the name 2020 were held in 2020.",
         "The Games were postponed and held from 23 July to 8 August 2021.", "The Games were postponed and held from 23 July to 8 August 2021, not in 2020.", "", "world", "medium", "sourced", **s)
    count = {}
    for c in O.values():
        count[c] = count.get(c, 0) + 1
    assert count["London"] == 2 and count["Tokyo"] == 2 and count["Athens"] == 1
    both("olympics", "twice", "London hosted the Summer Olympics twice between 1948 and 2024.", "Athens hosted the Summer Olympics twice between 1948 and 2024.",
         "London hosted in 1948 and 2012. Athens hosted in 2004 only, within these years.", "Athens hosted once in these years, in 2004. London hosted twice, in 1948 and 2012.", "", "world", "medium", "sourced", **s)

    W = read("worldcup.csv")
    s = src("https://en.wikipedia.org/wiki/List_of_FIFA_World_Cup_finals", "Wikipedia: List of FIFA World Cup finals")
    teams = sorted({r["winner"] for r in W} | {r["runner_up"] for r in W})
    fame = {"2022": "easy", "2018": "easy", "2014": "easy", "2010": "easy", "2006": "medium", "2002": "medium", "1998": "medium", "1994": "hard"}
    for r in W:
        y, w, ru, h = r["year"], r["winner"], r["runner_up"], r["host_country"]
        diff = fame[y]
        wrong_w = rng.choice([ru] if diff != "easy" else [t for t in teams if t not in (w, ru)])
        both("worldcup", f"win:{y}", f"{w} won the {y} FIFA World Cup.", f"{wrong_w} won the {y} FIFA World Cup.", f"{w} beat {ru} in the {y} final.", f"{w} won the {y} final, against {ru}. {wrong_w} did not win.", "", "world", diff, "sourced", **s)
        hosts = sorted({x["host_country"] for x in W if x["host_country"] != h})
        wrong_h = rng.choice(hosts)
        both("worldcup", f"host:{y}", f"The {y} FIFA World Cup was hosted by {C(h)}.", f"The {y} FIFA World Cup was hosted by {C(wrong_h)}.", f"The {y} tournament was hosted by {h}.", f"The {y} tournament was hosted by {h}, not {wrong_h}.", "", "world", "medium" if diff == "easy" else "hard", "sourced", **s)
        other = rng.choice([t for t in teams if t not in (w, ru)])
        both("worldcup", f"final:{y}", f"The {y} FIFA World Cup final was played between {w} and {ru}.", f"The {y} FIFA World Cup final was played between {w} and {other}.", f"The {y} final: {w} against {ru}.", f"The {y} final was {w} against {ru}, not {other}.", "", "world", "hard" if diff != "easy" else "medium", "sourced", **s)


def generate():
    planets()
    mountains()
    countries()
    states()
    elements()
    events()
    sport()
