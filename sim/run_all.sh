#!/bin/sh
# Predict: re-run every simulation and rebuild the balance report.
# Usage (from the Predict folder):  sh sim/run_all.sh
# Needs Python 3 only. sim/tools/ holds the three scripts from the game-design skill.
# They are not published in the public repo: copy them into sim/tools/ before running.
set -e
cd "$(dirname "$0")/.."
T=sim/tools
for s in economy_sim.py xp_curve.py validate_tables.py; do
  if [ ! -f "$T/$s" ]; then
    echo "Missing $T/$s. Copy economy_sim.py, xp_curve.py and validate_tables.py into sim/tools/ first (they are not in the public repo)." >&2
    exit 1
  fi
done
mkdir -p sim/out

echo "1/6 scoring rule (about 30 seconds)"
python3 sim/scoring_sim.py --json sim/out/scoring_results.json > sim/out/scoring_report.txt

echo "2/6 session economy"
python3 $T/economy_sim.py sim/session_economy.json --runs 500 --steps 180 > sim/out/economy_compare.txt
python3 $T/economy_sim.py sim/session_economy.json --runs 300 --steps 90 --set map_target=99999 --csv sim/out/traj.csv > sim/out/economy_noend.txt
python3 $T/economy_sim.py sim/session_economy.json --runs 300 --steps 240 --strategy designed_session --sweep show_up=0.6,0.75,0.9,1.0 > sim/out/economy_sweep_attendance.txt
{
  echo "halve on a missed day (cool=0.5):"
  python3 $T/economy_sim.py sim/session_economy.json --runs 300 --steps 90 --strategy designed_session --set map_target=99999 --set cool=0.5 | sed -n '/Mean (p10/,/^$/p'
  echo "hard reset (cool=1.0):"
  python3 $T/economy_sim.py sim/session_economy.json --runs 300 --steps 90 --strategy designed_session --set map_target=99999 --set cool=1.0 | sed -n '/Mean (p10/,/^$/p'
} > sim/out/economy_streak.txt

echo "3/6 level curve"
python3 $T/xp_curve.py --model power --base 140 --exp 1.2 --levels 50 --xp-per-minute 52 --xp-growth 1.0 --csv data/levels.csv > sim/out/levels_report.txt

echo "4/6 unit pacing"
python3 sim/pacing.py > sim/out/pacing_report.txt

echo "5/6 table validation"
python3 $T/validate_tables.py data/*.csv \
  --ref first_unit=data/units.csv:id --ref after_unit=data/units.csv:id \
  --ref enables_unit=data/units.csv:id --ref runs_alongside=data/units.csv:id \
  --required id --required name --required gate_rule --required lesson --required exit_test --required requirements \
  > sim/out/validation.txt
cat sim/out/validation.txt

echo "6/6 balance report"
python3 sim/make_balance_report.py
