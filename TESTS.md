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
