#!/usr/bin/env python3
"""Independent reference for Block 9 (Know yourself): written from design/mechanics.md 4.13 with exact fractions, not from app/js/engine/know.js.

Prints JSON that tools/engine_tests/b9.mjs compares with the app's own functions.
  posterior   Bayes posterior of a prior after evidence with a likelihood ratio (how many times likelier the evidence is if the claim is false)
  breakeven   the act-if-above line of a decision, the rule's choice, and what each choice pays for each outcome
  memory      drift of recalled against recorded (positive = moved toward what happened) and the L12 verdict on a series
  gate        Unit 7/8/9 verdicts
"""
import json
from fractions import Fraction as F

def posterior(prior, lr):
    odds = F(prior) / (1 - F(prior)) / F(lr)
    return odds / (1 + odds)

def breakeven(gain, loss):
    return F(loss, gain + loss)

def rule(p, gain, loss):
    return 'act' if F(p) > breakeven(gain, loss) else 'hold'

def pays(choice, gain, loss, yes):
    if choice == 'hold':
        return 0
    return gain if yes else -loss

def shift(recalled, recorded, up):
    d = F(recalled) - F(recorded)
    return d if up else -d

def l12(series, window=10, min_shift=F(1, 10)):
    """series: [(recalled, recorded, up)] oldest first. Fires on the last `window` when the mean shift >= min_shift."""
    if len(series) < window:
        return None
    w = series[-window:]
    m = sum(shift(*x) for x in w) / window
    return m >= min_shift

def main():
    out = {}
    out['posterior'] = []
    for prior in ['1/10', '1/5', '3/10', '1/2', '3/5', '4/5', '9/10']:
        for lr in ['1/3', '1/2', '1', '2', '3', '5']:
            out['posterior'].append({'prior': float(F(prior)), 'lr': float(F(lr)), 'post': float(posterior(prior, lr))})
    out['breakeven'] = []
    for gain, loss in [(1, 1), (10, 30), (30, 10), (100, 25), (7, 3), (50, 50), (1, 99), (1000, 1)]:
        for p in ['1/10', '1/4', '1/2', '3/4', '9/10', '99/100']:
            for yes in (True, False):
                out['breakeven'].append({'gain': gain, 'loss': loss, 'p': float(F(p)), 'yes': yes, 'threshold': float(breakeven(gain, loss)), 'rule': rule(p, gain, loss),
                                         'act': pays('act', gain, loss, yes), 'hold': pays('hold', gain, loss, yes)})
    out['memory'] = [{'recalled': r, 'recorded': c, 'up': u, 'shift': float(shift(F(r).limit_denominator(100), F(c).limit_denominator(100), u))}
                     for r, c, u in [(0.7, 0.6, True), (0.7, 0.6, False), (0.55, 0.65, True), (0.55, 0.65, False), (0.8, 0.8, True), (0.99, 0.5, True), (0.01, 0.99, False)]]
    # L12: a series with drift 0.10 exactly fires; just under does not; fewer than 10 never fires
    base = [(F(60, 100), F(50, 100), True)] * 10
    out['l12'] = {
        'exact': l12(base),
        'under': l12([(F(59, 100), F(50, 100), True)] * 10),
        'few': l12(base[:9]),
        'mixed': l12([(F(70, 100), F(60, 100), True)] * 5 + [(F(55, 100), F(60, 100), True)] * 5),
        'last10': l12([(F(40, 100), F(60, 100), True)] * 5 + base),
    }
    # gates: right counts
    out['gates'] = {'U7': {'need': 22, 'of': 28}, 'U8': {'need': 24, 'of': 30, 'drift': 0.05}, 'U9': {'need': 24, 'of': 30}}
    out['gate_cases'] = [{'unit': u, 'right': k, 'pass': k >= g['need']} for u, g in (('U7', {'need': 22}), ('U8', {'need': 24}), ('U9', {'need': 24})) for k in (g['need'] - 1, g['need'], g['need'] + 3)]
    print(json.dumps(out))

if __name__ == '__main__':
    main()
