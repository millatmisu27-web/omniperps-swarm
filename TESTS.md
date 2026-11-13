# Test + demo run — captured 2026-11-13T19:42:57Z

## npm test summary
ℹ tests 21
ℹ suites 0
ℹ pass 21
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0

## npm run demo (tail)
  [risk -> execution] (approve_reduced) APPROVED (reduced) — size 0.1304 BTC, liq @ $55493.55 (19.6% away). liquidation distance 19.6% is thin — size halved as a precaution
  [execution -> swarm] (executed) OPENED LONG 0.1304 BTC @ $69020.1 — margin $1800.04, liq @ $55493.55. Settlement intent produced.
  [risk -> execution] (force_reduce) FORCE-REDUCE 50% @ $62808.29 — liquidation distance 11.6% < protection 12% — cutting position in half. Realised PnL on closed half: $-405.01
  [risk -> execution] (force_reduce) FORCE-REDUCE 50% @ $61772.99 — liquidation distance 10.2% < protection 12% — cutting position in half. Realised PnL on closed half: $-236.26
  [risk -> execution] (force_reduce) FORCE-REDUCE 50% @ $60737.69 — liquidation distance 8.6% < protection 12% — cutting position in half. Realised PnL on closed half: $-135.00
  [risk -> execution] (force_reduce) FORCE-REDUCE 50% @ $59702.39 — liquidation distance 7.0% < protection 12% — cutting position in half. Realised PnL on closed half: $-75.94
  [risk -> execution] (force_close) FORCE-CLOSE @ $58667.09 — liquidation distance 5.4% < critical 7% — closing to save remaining margin. Realised PnL: $-84.38
  [demo-cli -> swarm] (kill) KILL SWITCH ENGAGED — all agents halted
  [risk -> swarm] (blocked) Cycle skipped: kill switch engaged
  [demo-cli -> swarm] (resume) Kill switch released — agents may trade again

DEMO RESULT: PASS — position opened by the swarm, protection acted before liquidation, kill switch blocked trading
