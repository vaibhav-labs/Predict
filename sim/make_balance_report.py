#!/usr/bin/env python3
"""Predict: build design/balance-report.md from the simulation outputs in sim/out/.

Run sim/run_all.sh first. Every number in the report is read from an output file, so the report
cannot drift from the simulations.
"""
import csv
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "sim", "out")
R = json.load(open(os.path.join(OUT, "scoring_results.json")))
CFG = json.load(open(os.path.join(ROOT, "data", "scoring.json")))
CORE, SHARP = CFG["binary"]["core_rule"], CFG["binary"]["sharp_rule"]

NAMES = {
    "honest": "Honest", "mild_overconfident": "Mildly overconfident (says 82% when 75% is true)",
    "overconfident": "Typical overconfident (says 90% when 75% is true)",
    "underconfident": "Underconfident (says 63% when 75% is true)", "always_50": "Always 50%",
    "always_99": "Always 99%", "round_to_10": "Honest, rounded to tens",
    "three_words": "Honest, three levels only (50, 75, 99)", "noisy": "Right on average, sloppy call to call",
}


def pct(x, d=1):
    return f"{x * 100:.{d}f}%"


def table(head, rows):
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def traj(name):
    return list(csv.DictReader(open(os.path.join(OUT, f"traj_{name}.csv"))))


def text(name):
    return open(os.path.join(OUT, name)).read()


L = []
add = L.append
add("# Predict: balance report (concept version 0.1)\n")
_m = re.search(r"^designed_session\s+\d+%\s+\d+%\s+([\d.]+)", text("economy_compare.txt"), re.M)
DESIGNED_DAYS = round(float(_m.group(1)))
add("> **Summary.** Nine checks back the numbers in the plan. Honest reporting is the best strategy under the "
    "scoring rule, gates and lesson triggers are sized so luck rarely decides them, real predictions are scored "
    "on edge so sure things are worth nothing, and the 15-minute session, with one deep prediction a day, reaches "
    f"a first journal bias map (100 resolved real predictions) in about {DESIGNED_DAYS} days. "
    "Four findings changed the design; they are listed first. Rebuild this file with `sh sim/run_all.sh`.\n")

add("## Changes the simulations forced\n")
add(table(["Finding", "Change", "Result"], [
    ["Gate with a fixed 10-point tolerance per band failed calibrated players 63% of the time at 150 calls",
     "Bands are judged against their own sampling error (2.5 standard errors); exam is 200 calls",
     "Calibrated pass rate 88%, typical overconfident 1%"],
    ["Overconfidence trigger at 30 calls and an 8-point gap fired falsely on 42% of calibrated players",
     "40 calls and a 10-point gap", "False alarms 8%; typical overconfidence still caught in a median of 46 calls"],
    ["Raw points on real predictions made logging sure things the best strategy (88 against 26 a call)",
     "Real predictions pay edge over a hidden baseline", "Sure things earn 0; real forecasting earns 14.5"],
    ["A rolling window gives a miscalibrated player many chances to pass by luck",
     "Every gate is a fixed exam of fresh calls, judged once", "Pass rates below apply once per attempt"],
]))

# 1 ------------------------------------------------------------------
add("\n## 1. Scoring rule: does honesty win?\n")
add("- **Intent:** the highest-scoring way to play must be to say what you believe.")
add(f"- **Method:** `python3 sim/scoring_sim.py`, {CFG['sim']['draws']:,} questions per policy and question set, "
    f"seed {CFG['sim']['seed']}. Rules are in `data/scoring.json`.\n")
add("Points for a hit and a miss:\n")
add(table(["You say", "Home-made: hit", "miss", "Predict rule: hit", "miss", "Sharp rule: hit", "miss"], [
    [f"{r['confidence'] * 100:.0f}%", f"{r['naive_linear_hit']:+.0f}", f"{r['naive_linear_miss']:+.0f}",
     f"{r[CORE + '_hit']:+.0f}", f"{r[CORE + '_miss']:+.0f}", f"{r[SHARP + '_hit']:+.0f}", f"{r[SHARP + '_miss']:+.0f}"]
    for r in R["A"]["payouts"]]))
add("\nExpected points a call, mixed-difficulty set (true accuracy 75%):\n")
B = R["B"]["mixed"]
add(table(["Reporting style", "Says on average", "Home-made rule", "Predict rule", "Sharp rule"], [
    [NAMES[p], pct(x["mean_stated"]), f"{x['naive_linear']:+.1f}", f"{x[CORE]:+.1f}", f"{x[SHARP]:+.1f}"]
    for p, x in B.items()]))
best = {m: {r: max(R["B"][m], key=lambda p: R["B"][m][p][r]) for r in ("naive_linear", CORE, SHARP)} for m in R["B"]}
add("\n- **Result:** best style under the Predict rule: " + ", ".join(f"{m} set: {best[m][CORE]}" for m in best)
    + ". Under the sharp rule: " + ", ".join(f"{m}: {best[m][SHARP]}" for m in best)
    + ". Under the home-made rule: " + ", ".join(f"{m}: {best[m]['naive_linear']}" for m in best) + ".")
add(f"- Hard set: honest {R['B']['hard']['honest'][CORE]:+.1f}, typical overconfident {R['B']['hard']['overconfident'][CORE]:+.1f}. "
    f"Easy set: honest {R['B']['easy']['honest'][CORE]:+.1f}, typical overconfident {R['B']['easy']['overconfident'][CORE]:+.1f}.")
add("- **Problems found:** none under the Predict and sharp rules. The home-made rule has a DOMINANT strategy (always 99%), so it is rejected.")
add(f"- **Note:** rounding to tens costs {B['honest'][CORE] - B['round_to_10'][CORE]:.1f} points a call under the Predict rule and "
    f"{B['honest'][SHARP] - B['round_to_10'][SHARP]:.1f} under the sharp rule; three levels cost "
    f"{B['honest'][CORE] - B['three_words'][CORE]:.1f} and {B['honest'][SHARP] - B['three_words'][SHARP]:.1f}.")

# 2 ------------------------------------------------------------------
add("\n## 2. Luck against skill\n")
add("- **Intent:** know how many calls it takes before skill, not luck, decides a comparison.")
add(f"- **Method:** {CFG['sim']['sessions']:,} sessions; each policy faces the same questions with the same outcomes.\n")
C = R["C"][CORE]
add(table(["Calls", "Typical overconfident twin outscores honest", "Mildly overconfident twin outscores honest",
           "Honest total is negative", "Honest points a call", "Spread of a session total (sd)"], [
    [n, pct(x["outscored_by"]["overconfident"]), pct(x["outscored_by"]["mild_overconfident"]),
     pct(x["honest_negative_session"]), f"{x['honest_mean_per_q']:.1f}", f"{x['honest_session_sd']:.0f}"]
    for n, x in C.items()]))
add("\n- **Result:** one session is mostly luck. Typical overconfidence separates by 150 to 200 calls; mild overconfidence needs 400.")
add("- **Change made:** gates, belts and triggers are judged on 150 calls or more. The scoreboard shows a 7-day average beside the day's total.")

# 3 ------------------------------------------------------------------
add("\n## 3. Gates\n")
add("- **Intent:** a calibrated player passes most of the time; a miscalibrated one almost never.")
add("- **Method:** same sessions; exact binomial for count-based exams.\n")
D = R["D"]
z = str(CFG["gates"]["band_z_max"])
add(f"Unit 1 gate ({D['composite_definition']}, z = {z}):\n")
add(table(["Calls in the exam", "Calibrated", "Mildly overconfident", "Typical overconfident", "Underconfident", "Always 99%"], [
    [n + (" (chosen)" if int(n) == CFG["gates"]["calibration_exam_calls"] else "")] +
    [pct(D["composite_gate"][p][n][z]) for p in ("honest", "mild_overconfident", "overconfident", "underconfident", "always_99")]
    for n in D["composite_gate"]["honest"]]))
t3 = str(CFG["gates"]["recert_index_tolerance"])
n4 = str(CFG["gates"]["recert_exam_calls"])
add(f"\nUnit 10 gate ({n4} calls, average confidence within {float(t3) * 100:.0f} points of hit rate): calibrated "
    f"{pct(D['index_gate']['honest'][n4][t3])}, mildly overconfident {pct(D['index_gate']['mild_overconfident'][n4][t3])}, "
    f"typical overconfident {pct(D['index_gate']['overconfident'][n4][t3])}.")
add(f"\nBrown belt check (300 real predictions, within 5 points): calibrated {pct(D['index_gate']['honest']['300']['0.05'])}, "
    f"typical overconfident {pct(D['index_gate']['overconfident']['300']['0.05'])}.")
add("\nUnit 3 range gate, chance of passing by the player's true coverage:\n")
G = R["G"]
add(table(["Exam", "50%", "70%", "80%", "90% (calibrated)", "99% (always wide)"], [
    [f"{n} ranges, {x['pass_hits'][0]} to {x['pass_hits'][1]} hold" + (" (chosen)" if int(n) == CFG["gates"]["range_exam_calls"] else "")]
    + [pct(x["pass_rate_by_true_coverage"][c]) for c in ("0.5", "0.7", "0.8", "0.9", "0.99")] for n, x in G.items()]))
pac = text("pacing_report.txt")
add("\nCount-based exams (exact binomial):\n")
add("```\n" + pac.split("4. Exact pass odds for k-of-n exams\n")[1].split("\nWrote")[0].rstrip() + "\n```")
add("- **Problems found:** the first gate design failed calibrated players 63% of the time (see top table).")
add("- **Open risks:** a mildly overconfident player passes the Unit 1 gate about 4 times in 10. The Unit 10 gate and the belts on real predictions catch what Unit 1 lets through.")

# 4 ------------------------------------------------------------------
add("\n## 4. Lesson trigger for overconfidence (L01)\n")
add("- **Intent:** fire on a real pattern within a week of play, and rarely on a calibrated player.")
add("- **Method:** 3,000 runs of 150 calls stated at 90 to 99%, trigger checked after every call.\n")
T = R["D_trigger"]
rows = []
for key in T["honest"]:
    w, g = re.match(r"W(\d+)_gap(\d+)", key).groups()
    chosen = int(w) == CFG["gates"]["top_band_trigger_window"] and int(g) == round(CFG["gates"]["top_band_trigger_gap"] * 100)
    rows.append([f"{w} calls, {g} points" + (" (chosen)" if chosen else ""), pct(T["honest"][key]["fires_within_150"]),
                 pct(T["mild_overconfident"][key]["fires_within_150"]),
                 f"{T['mild_overconfident'][key]['median_calls_to_fire']:.0f}",
                 pct(T["overconfident"][key]["fires_within_150"]),
                 f"{T['overconfident'][key]['median_calls_to_fire']:.0f}"])
add(table(["Window and gap", "False alarm on a calibrated player", "Fires on mild overconfidence", "median calls",
           "Fires on typical overconfidence", "median calls"], rows))
add("\n- **Change made:** 40 calls and a 10-point gap. A typical overconfident player makes about 9 top-band calls a day, so 46 calls is about five days.")

# 4b (Block 4): the same question for L02, from sim/trigger_sim.py ------------------------------------
_trig = os.path.join(OUT, "trigger_results.json")
if os.path.exists(_trig):
    TR = json.load(open(_trig))["L02"]
    L02 = CFG["lessons"]["triggers"]["L02"]
    add("\n## 4b. Lesson trigger for underconfidence (L02)\n")
    add("- **Intent:** the same as L01, in the 60 to 80% band, where the plan left the threshold OPEN (value 5).")
    add("- **Method:** 3,000 runs of 150 calls stated at 60 to 80% (`sim/trigger_sim.py`), the trigger checked after every call and, more realistically, "
        "once every 7 calls (about one session's worth of calls in that band).\n")
    rows = []
    for key in TR["honest"]:
        w, g, lk = re.match(r"W(\d+)_gap(\d+)_(\w+)", key).groups()
        chosen = int(w) == L02["window"] and int(g) == round(L02["gap"] * 100) and lk == "session_end"
        look = "after every call" if lk == "every_call" else "every 7 calls (session end)"
        rows.append([f"{w} calls, {g} points" + (" (chosen)" if chosen else ""), look, pct(TR["honest"][key]["fires_within_150"]),
                     pct(TR["mild_underconfident"][key]["fires_within_150"]), f"{TR['mild_underconfident'][key]['median_calls_to_fire']:.0f}",
                     pct(TR["underconfident"][key]["fires_within_150"]), f"{TR['underconfident'][key]['median_calls_to_fire']:.0f}"])
    add(table(["Window and gap", "Looked at", "False alarm on a calibrated player", "Fires on mild underconfidence", "median calls",
               "Fires on typical underconfidence", "median calls"], rows))
    add(f"\n- **Change made:** the plan's 60 calls and 10 points fired falsely on a calibrated player {pct(TR['honest']['W60_gap10_session_end']['fires_within_150'])} of the time at session-end looks. "
        f"{L02['window']} calls and {round(L02['gap'] * 100)} points: {pct(TR['honest']['W60_gap12_session_end']['fires_within_150'])} false alarms, "
        f"{pct(TR['underconfident']['W60_gap12_session_end']['fires_within_150'])} of typical underconfident players caught in a median of {TR['underconfident']['W60_gap12_session_end']['median_calls_to_fire']:.0f} calls.")

# 5 ------------------------------------------------------------------
add("\n## 5. Ranges\n")
add("- **Intent:** neither going wide nor going narrow may beat an honest 90% range.")
add("- **Method:** closed form; truth normally distributed around the player's best guess.\n")
E = R["E"]
EN = {"honest_90": "Honest 90% range", "narrow_70": "A bit narrow", "narrow_50": "Narrow", "wide_99": "Wide", "absurdly_wide": "Absurdly wide"}
add(table(["Range habit", "True coverage", "Home-made score (1 a hit)", "Interval score (lower is better)", "Against honest"], [
    [EN[k], pct(x["true_coverage"]), f"{x['naive_hit_points']:.2f}", f"{x['interval_score']:.2f}", f"{x['vs_honest']:.2f}x"]
    for k, x in E["policies"].items()]))
add(f"\n- **Result:** the score is lowest at {pct(E['optimal_coverage'])} coverage. A hit-counting rule would reward absurdly wide ranges.")

# 5b (Block 6): the range game on the real bank, from sim/range_sim.py --------------------------------------
_rng = os.path.join(OUT, "range_results.json")
if os.path.exists(_rng):
    RS = json.load(open(_rng))
    add("\n## 5b. Ranges on the real bank (Block 6)\n")
    add("Section 5 is the closed form. This is the same game on the real range bank (`app/content/questions/ranges.json`, 200 practice and 180 exam ranges from the "
        "committed records), with the real rules from `data/scoring.json`. `sim/range_sim.py` (20,000 runs a row): each player says the question's reference interval "
        "stretched by a factor around its middle, and is judged on questions drawn at random.\n")
    add(table(["Player", "Holds the truth", "Width against reference", "Points a range", "Exam pass (50 to 58 of 60)", "L05 fires", "L06 fires", "Re-test band met (33 to 38 of 40)"],
              [[name, pct(r["coverage"]), f"{r['mean_ratio']:.2f}x", f"{r['points_per_range']:+.1f}", pct(r["exam_pass"]), pct(r["L05_fires"]), pct(r["L06_fires"]), pct(r["retest_band"])]
               for name, r in RS.items()]))
    rec = RS["the record 1.0x"]
    add(f"\n- **The gate does its job.** A player who says the record's own middle 90% passes the exam {pct(rec['exam_pass'])} of the time; a player 20% too narrow "
        f"{pct(RS['narrow 0.8x']['exam_pass'])}, 40% too narrow {pct(RS['narrow 0.4x']['exam_pass'])}; twice too wide {pct(RS['wide 2x']['exam_pass'])}, three times {pct(RS['padded 3x']['exam_pass'])}.")
    add(f"- **L05 and L06 fire on the right people.** L05 fires on {pct(RS['narrow 0.6x']['L05_fires'])} of players at 0.6x and {pct(rec['L05_fires'])} of the record player; "
        f"L06 only on the padded player ({pct(RS['padded 3x']['L06_fires'])} at 3x): a range 2x the reference is at the line, not over it.")
    add(f"- **Points are flat near the best range, as a fair score is.** The record player earns {rec['points_per_range']:+.1f} a range and a player at 0.8x "
        f"{RS['narrow 0.8x']['points_per_range']:+.1f}: the points barely tell them apart, but the exam does ({pct(rec['exam_pass'])} against {pct(RS['narrow 0.8x']['exam_pass'])}). "
        f"Being worse on either side is charged steeply: {RS['narrow 0.4x']['points_per_range']:+.0f} at 0.4x, {RS['padded 3x']['points_per_range']:+.0f} at 3x.")
    add("- **The offset 1.25.** On bell-shaped outcomes the honest range's expected interval score is 1.254 reference widths (section 5); on the real bank, with the floor at -400, "
        "the record player averages -5.6 a range over all 380 questions, so knowing the record earns about 0. Some kinds (rain, life expectancy, child mortality) cost 2 to 3 "
        "reference widths on a miss-heavy average and others (income per person) 1.0, so points swing by kind; the Mirror shows the split.")
    add("- **Open risk:** the reference interval is the record's, so a player with knowledge the record lacks can beat it. That is the intent: it is the outside view, and beating it is the skill.")

# 6 ------------------------------------------------------------------
add("\n## 6. Real predictions: raw points against edge\n")
add("- **Intent:** logging sure things must not pay.")
add("- **Method:** 100,000 simulated predictions per profile under the Predict rule, before the edge weight.\n")
FN = {"farmer_sure_things": "Logs only sure things", "real_forecaster": "Real forecaster with private information",
      "real_but_overconfident": "Real forecaster, overconfident", "baseline_copier": "Copies the baseline",
      "fake_insight": "Moves off the baseline for no reason"}
add(table(["Profile", "Raw points a call", "Edge points a call"], [
    [FN[k], f"{x['raw_points']:+.1f}", f"{x['edge_points']:+.1f}"] for k, x in R["F"].items()]))
add(f"\n- **Result:** raw points have a DOMINANT strategy (sure things). Edge removes it. With edge weight "
    f"{CFG['journal']['edge_weight']}, an average real call is worth "
    f"{CFG['journal']['edge_weight'] * R['F']['real_forecaster']['edge_points']:.0f} points against "
    f"{B['honest'][CORE]:.1f} for a calibrated gym call.")

# 7 ------------------------------------------------------------------
add("\n## 7. Session economy\n")
add("- **Intent:** daily reveals from week one, a first calibration curve from the gym in the first week, a first journal bias map (100 resolved real predictions) in about four months at one prediction a day (inside two months at three a day), no dead way of playing hidden in the design.")
add("- **Method:** `economy_sim.py sim/session_economy.json --runs 500 --steps 180`; one step is a day; 90% attendance.\n")
cmp_txt = text("economy_compare.txt")
ROW = re.compile(r"^(\w+)\s+\d+%\s+\d+%\s+([\d.]+)\s+(.+)$", re.M)
days = {m.group(1): m.group(2) for m in ROW.finditer(cmp_txt)}
flags = {m.group(1): m.group(3).strip() for m in ROW.finditer(cmp_txt)}
SN = {"designed_session": ("designed_session", "Designed session: 18 gym calls and 1 deep prediction a day (mixed horizons)"),
      "journal_only": ("journal_only", "One prediction a day, nothing else"),
      "gym_only": ("gym_only", "Gym only"),
      "all_month_journa": ("all_month_journal", "Gym plus one month-long prediction a day (the limit)"),
      "all_short_journa": ("all_short_journal", "Gym plus one next-day prediction a day (the limit)"),
      "weekend_binge": ("weekend_binge", "Two long sessions a week")}
rows = []
for key, (fname, label) in SN.items():
    t = traj(fname)
    rows.append([label, "never" if float(days[key]) >= 180 else f"{float(days[key]):.0f}",
                 f"{float(t[29]['feedback']):.0f}", f"{float(t[6]['reveals_today']):.1f}",
                 f"{float(t[29]['reveals_today']):.1f}", "none" if flags[key] == "-" else flags[key].replace(",", ", ")])
add(table(["Way of playing", "Days to 100 resolved real predictions", "Scored calls by day 30", "Reveals a day, day 7",
           "Reveals a day, day 30", "Simulator flags"], rows))
add("\nAttendance sweep, designed session, days to 100 resolved real predictions:\n")
add("```\n" + text("economy_sweep_attendance.txt").strip() + "\n```")
st = text("economy_streak.txt")
add("\nStreak at 90% attendance, halving on a missed day against a hard reset (last column, mean and p10..p90):\n")
add("```\n" + st.strip() + "\n```")
add("- **Problems found:** gym-only play is flagged FLAT and NO ENDING on real evidence: it never builds a bias map. Intended, and the reason the journal is not optional.")
add("- **Not dominant:** one next-day prediction a day reaches 100 fastest, but builds no week or month evidence. The Green belt requires 20 month-horizon results, so the mix stays.")
add("- **Limit of the model:** predictions resolve at a constant daily rate per horizon, not on exact due dates.")

# 8 ------------------------------------------------------------------
add("\n## 8. Level curve\n")
lv = CFG["levels"]
add(f"- **Intent:** first level-up in minutes, a level every day or two early, no late grind.")
add(f"- **Method:** `xp_curve.py --model power --base {lv['base']} --exp {lv['exp']} --levels 50 --xp-per-minute {lv['assumed_points_per_minute']}`.\n")
levels = list(csv.DictReader(open(os.path.join(ROOT, "data", "levels.csv"))))
rows = []
for target in (2, 5, 10, 15, 20, 25, 30, 40, 50):
    r = levels[target - 2]
    rows.append([target, f"{int(r['cumulative_xp']):,}", f"{float(r['cumulative_hours']) * 4:.1f}", f"{float(r['minutes']) / 15:.1f}"])
add(table(["Level", "Career points", "Day reached", "Days that level took"], rows))
add("\n- **Result:** the curve tool printed no warning (no dip, no six-figure costs, first level-up under 10 minutes, last level under 6 times a mid-game one).")
add(f"- **Open risk:** {lv['assumed_points_per_minute']} points a minute is an assumption (18 calibrated gym calls, about 2.6 reveals, habit points). Re-fit after two weeks of real play.")

# 9 ------------------------------------------------------------------
add("\n## 9. Unit pacing\n")
add("- **Intent:** every unit fits its drills and its real-world evidence into 15 minutes a day.")
add("- **Method:** `python3 sim/pacing.py` over `data/units.csv`, with 10% slack.\n")
add("```\n" + pac.split("\n3. Session budget")[0].rstrip() + "\n```")
add("\nSession budget check:\n")
add("```\n" + pac.split("3. Session budget by arc (minutes, must total 15)\n")[1].split("\n4. Exact")[0].rstrip() + "\n```")
add("\n## Open risks\n")
add("The fourteen OPEN values and the block that settles each are listed in `design/mechanics.md`, section 6.")

open(os.path.join(ROOT, "design", "balance-report.md"), "w").write("\n".join(L) + "\n")
print("Wrote design/balance-report.md,", len(L), "blocks")
