#!/usr/bin/env python3
"""Render docs/images/backtest.png from docs/backtest-run.json.

Charts ONLY the real run data produced by scripts/backtest.js:
top panel = BTC daily closes across the drawdown window with event
markers; bottom panel = account equity, unprotected vs protected.
Requires matplotlib (present in the build sandbox). If it is missing,
backtest.js notes the fallback and this script is simply not run.
"""
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
with open(os.path.join(ROOT, "docs", "backtest-run.json")) as f:
    run = json.load(f)

win = run["window"]
cw = run["chartWindow"]
dates = [c["date"] for c in cw]
closes = [c["close"] for c in cw]

a = run["unprotected"]
b = run["protected"]


def curve_by_date(path_result):
    return {pt["date"]: pt["equity"] for pt in path_result["equityCurve"]}


eq_a = curve_by_date(a)
eq_b = curve_by_date(b)
eq_dates = [d for d in dates if d in eq_a or d in eq_b]
start_equity = 100000.0
last_a = start_equity
last_b = start_equity
ys_a, ys_b = [], []
for d in eq_dates:
    last_a = eq_a.get(d, last_a)
    last_b = eq_b.get(d, last_b)
    ys_a.append(last_a)
    ys_b.append(last_b)

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 7), sharex=True,
                               gridspec_kw={"height_ratios": [3, 2]})
fig.suptitle(
    f"OmniPerps protection backtest — BTC drawdown {win['peakDate']} → {win['troughDate']} "
    f"({win['dropPct']}% peak-to-trough, Kraken daily candles)",
    fontsize=12, fontweight="bold",
)

ax1.plot(dates, closes, color="#2470c7", lw=1.6, label="BTC daily close (real Kraken data)")
ax1.axhline(run["entry"]["liquidationPrice"], color="#c7243a", ls="--", lw=1.0,
            label=f"Liquidation price ${run['entry']['liquidationPrice']:,.0f}")
entry_date = win["peakDate"]
if entry_date in dates:
    ax1.plot(dates.index(entry_date), win["entryClose"], "o", color="#f5a623", ms=9,
             label=f"Entry LONG {run['entry']['sizeBtc']} BTC @ ${win['entryClose']:,.0f} (x5)")
for ev in b["events"]:
    if ev["date"] in dates:
        ax1.plot(dates.index(ev["date"]), ev["price"], "v", color="#1d9e75", ms=8)
if b["events"]:
    ax1.plot([], [], "v", color="#1d9e75", ms=8, label="Risk protection events (protected path)")
if a["liquidated"]:
    d = a["liquidated"]["date"]
    if d in dates:
        ax1.plot(dates.index(d), a["liquidated"]["price"], "X", color="#c7243a", ms=13,
                 label=f"Unprotected LIQUIDATED {d}")
ax1.set_ylabel("BTC/USD")
ax1.grid(alpha=0.25)
ax1.legend(fontsize=8, loc="lower left")

ax2.plot(eq_dates, ys_a, color="#c7243a", lw=1.6,
         label=f"Unprotected: PnL ${a['realisedPnlTotal']:,.2f}, wallet ${a['finalWallet']:,.2f}")
ax2.plot(eq_dates, ys_b, color="#1d9e75", lw=1.6,
         label=f"Swarm-protected: PnL ${b['realisedPnlTotal']:,.2f}, wallet ${b['finalWallet']:,.2f}")
ax2.set_ylabel("Account equity ($, paper)")
ax2.grid(alpha=0.25)
ax2.legend(fontsize=8, loc="lower left")

step = max(1, len(dates) // 10)
ax2.set_xticks(range(0, len(dates), step))
ax2.set_xticklabels([dates[i] for i in range(0, len(dates), step)], rotation=30, ha="left", fontsize=8)
fig.tight_layout(rect=[0, 0, 1, 0.95])
out = os.path.join(ROOT, "docs", "images", "backtest.png")
os.makedirs(os.path.dirname(out), exist_ok=True)
fig.savefig(out, dpi=110)
print(f"chart written: {out}")
