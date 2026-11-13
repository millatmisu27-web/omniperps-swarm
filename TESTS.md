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

---

# Upgrade verification — captured 2026-11-13 ~20:16–20:23 UTC

## Re-run after upgrades: npm test / npm run demo
ℹ tests 21
ℹ pass 21
ℹ fail 0

DEMO RESULT: PASS — position opened by the swarm, protection acted before liquidation, kill switch blocked trading (live Kraken price $68,969.60; force-reduce ladder at 11.1% / 9.5% / 8.1%, force-close at 6.6%, liquidations: 0)

## scripts/mpc-proof.js (real MPC signature, fetched live from testnet RPC)
payload (sha256 of the labelled demo message): 10929e760c75c6837c69d24f5e8c9deb0e177c7b3d0fc26824dd948283290353
sign tx: E9TZrQ3wVWFSoED61XKi1HowPi6w4XB5fDnMykWZpX8b
signature response from MPC contract: {"scheme":"Secp256k1","big_r":{"affine_point":"035eb0d9ce65640b3e315308ce73e4eb9a90a52d261c6aa71b65c1f960f30babc2"},"s":{"scalar":"5ed1aba513ce2c0715b5d71391931292f57d36c85e451b7008a218c9c4bcb653"},"recovery_id":0}
expected EVM address (derived): 0x28ece91f7e9506d4c6f6a8d36db270d4ec1a688d
ECDSA verify against derived public key: PASS
ecrecover address: 0x28ece91f7e9506d4c6f6a8d36db270d4ec1a688d
ecrecover matches derived EVM address: PASS
*** MPC SIGNATURE VERIFIED: the NEAR MPC network really signed this payload for 0x28ece91f7e9506d4c6f6a8d36db270d4ec1a688d ***

## scripts/guard-proof.js (deployed SpendGuard contract, live)
LIVE get_state: {"owner":"omniperps-swarm.testnet","max_notional_per_order":25000,"max_leverage":10,"min_liquidation_distance_pct":12,"max_daily_realised_loss":5000,"killed":false,"checks_count":0}
check_order(in-limit $9,000 / 5x / 40% / $0) -> {"allowed":true,"reason":"ok"}  [tx DFdxpfAPHGEDxwmUWf43neyEF1d9rASsAbGVN2PrRHoL] — PASS
check_order(oversize $40,000) -> {"allowed":false,"reason":"notional 40000 exceeds per-order cap 25000"}  [tx FJrLntEXpLnfDjSbqrXj4mszgy1daWYu8brfztuG12S2] — PASS
set_killed(true) by owner -> {"killed":true}  [tx BGsSMMHyGUAA2pQUEYcYYzSDDT6LVtwMovXpYa6C11Na]
check_order(in-limit, kill switch ON) -> {"allowed":false,"reason":"KILL SWITCH is engaged - all trading halted"}  [tx 928KpuJpt65LhRzhqKVfu5zEpiGFPp1cDqkRiw5JP2hB] — PASS
set_killed(false) by owner -> {"killed":false}  [tx Ap1zedwqcJdVVXCuZjZg7d2UTpkpCCpPD9jRJyeW6hxT]
get_state after: checks_count=3, killed=false — PASS (all 3 checks recorded; kill switch left OFF)
*** SPENDGUARD CONTRACT PROOF: ALL CHECKS PASSED against the live testnet contract ***

## Server bonus (OMNIPERPS_GUARD_CHAIN=1), smoke-tested 2026-11-13 ~20:22 UTC
Flag ON, after POST /api/cycle the swarm transcript gains (live testnet read):
  "On-chain SpendGuard [api-cycle]: LIVE testnet read of guard.omniperps-swarm.testnet — killed=false, checks_count=3, caps: $25000/order, 10x, min liq distance 12%, daily loss $5000."
Flag OFF (default): no such entries; demo behaviour unchanged. The read is fire-and-forget and fail-safe — a failed RPC read logs to the server console only.

---

# Wave 2 verification — captured 2026-11-13 ~20:38–21:00 UTC

## npm test (grew 21 -> 27: +3 replay-feed, +3 settlement-math)
ℹ tests 27
ℹ pass 27
ℹ fail 0

## npm run demo (live) — PASS
DEMO RESULT: PASS — position opened by the swarm, protection acted before liquidation, kill switch blocked trading

## npm run demo -- --replay (offline, recorded real Kraken candles)
REPLAY MODE: REPLAY — recorded real prices (Kraken XBTUSD (BTC/USD), 1m candles, captured 2026-11-13T20:38:52Z)
Position opened on the recorded tape @ $69,025.10; protection ladder fired under the labelled simulated stress; kill switch blocked; DEMO RESULT: PASS.

## Server LIVE ⇄ REPLAY toggle (manual, via /api/feed-mode)
- boot: mode live, source kraken, BTC $68,818.6
- POST {mode:"replay"} -> mode replay, source replay, banner label "REPLAY — recorded real prices (Kraken XBTUSD (BTC/USD), 1m candles, captured 2026-11-13T20:38:52Z)", recorded prices stepping
- POST {mode:"live"} -> back to live/Kraken

## Hosted demo (demo-dist) — headless-browser verified
- Page boots the in-browser glue with no page errors; initial mode came up REPLAY with autoSwitched=true: from a file:// origin the live cross-origin fetches are blocked, so the AUTO-FALLBACK fired exactly as designed (over HTTPS hosting the live feed gets its normal chance first).
- Manual REPLAY toggle: banner visible with the recorded-prices label; settlements section renders run #1; back to LIVE works; settlements count 1.

## scripts/settle-fees.js (real testnet transfers)
Session ledger: signal 2.00, risk 21.50, execution 13.00 units @ 0.01 NEAR/unit.
  PAID signal: 0.0200 NEAR -> omniperps-agent1-7f3a.testnet  tx Fzwj5hDDEBUvPhj4amwckGvdXYxY48CxpjjKoXeQPRpJ
  PAID risk:   0.2150 NEAR -> omniperps-agent2-7f3a.testnet  tx 6CJihsoCzYSAf8rtj31YCGtvwG53jY8VtG2kq1rn2shN
  execution 13 units -> 0.1300 NEAR retained by the payer (master account; no self-transfer)
Master 2.986434 -> 2.751345 NEAR; agent1 10 -> 10.02 NEAR; agent2 10 -> 10.215 NEAR (independent RPC reads).

## scripts/backtest.js (real Kraken daily candles)
Window: peak 2026-01-17 (high $95,600, entry close $95,089.9) -> trough 2026-02-06 (low $60,500) = -36.72% in 20 days
Entry: LONG 0.0947 BTC @ $95,089.9 x5 (Risk verdict: approve_reduced), margin $1,801, liq @ $76,454.19
UNPROTECTED: LIQUIDATED on 2026-01-31 @ $75,600 — realised PnL $-1,801, final wallet $98,194.49
PROTECTED:   no liquidation — force-reduce x5 (2026-01-25 x2, 01-26, 01-29 x2), force-close 2026-01-30 — realised PnL $-877.48, final wallet $99,113.95
Chart rendered from the run data: docs/images/backtest.png. Full methodology: docs/BACKTEST.md.

## Screenshots (tools/shots/capture.js, headless Chromium, real console)
docs/images/console-overview.png — live position open, settlement record visible
docs/images/stress-protection.png — FORCE-REDUCE 50% @ $62,706.37 in the log, liquidations 0
docs/images/kill-switch.png — banner + "Cycle skipped: kill switch engaged"
docs/images/replay-mode.png — REPLAY banner (selected manually) + recorded-price chart
