# BUILD_LOG — OmniPerps Swarm

All times UTC, 2026-11-13 (build night; deadline 2026-11-14T23:59Z).

- 19:38 — Read HACKATHON.md (official rules) + Hard 1 plan. Tracks confirmed: defi (primary), swarms, agents, security. Submission contract noted (fields, track ids, one-submission rule, human-only steps).
- 19:39 — Environment check: Node v24.22.1, npm 10.9.4, Python 3.12, git 2.43. **No Rust toolchain** → NEAR contract route switched to JS/policy-module plan per build brief. Price sources probed: Binance geo-blocked, Bybit CloudFront-blocked, **Kraken OK, Coinbase OK, CoinGecko OK**. NEAR testnet + mainnet RPC reachable; near-faucet.io reachable.
- 19:40 — Stack chosen: **zero-dependency Node.js** (node:http server, node:test) — nothing to install, fastest to verify, reproducible for judges. Repo scaffolded at ~/workspace/omni-perps (git init).
- 19:41 — NEAR leg delegated to a dedicated agent (RPC proof, testnet account creation attempt, chain-signatures derivation, settlement intent) writing only src/near-proof.js + docs/NEAR_PROOF.md.
- 19:42 — Core built: src/perps.js (isolated-margin engine), src/policy.js (SpendGuard), src/pricefeed.js (Kraken→Coinbase→CoinGecko), src/agents.js (Signal/Risk/Execution + fee ledger + intents), server.js + public/ console (chart, position, agents, guard, logs, NEAR panel), scripts/demo-cli.js, 21 tests.
- 19:42 — Test fix: liquidation check corrected to position-level equity (isolated-margin semantics) — account-level equity masked liquidation in the first run.
- 19:43 — **npm test: 21/21 PASS.**
- 19:43 — **npm run demo: PASS** on live Kraken price ($69,020.50): swarm opened LONG 0.1304 BTC (after Risk halved the proposal), simulated stress → 4 laddered force-reduces + force-close, **liquidations 0**, kill switch blocked a new cycle, fee ledger paid all three agents.
- 19:44 — **Server smoke test PASS:** dashboard HTTP 200, /api/state shows live Kraken price $69,020 + 63 real history points, swarm auto-opened a position, kill switch toggled on/off via API.
- 19:45 — Docs written: README (judge steps, live-vs-simulated table), DEMO_SCRIPT, SUBMISSION_CHECKLIST (paste-ready X post + form description), TESTS.md (captured real output), LICENSE (MIT), .gitignore.

## Remaining
- NEAR leg results (src/near-proof.js + docs/NEAR_PROOF.md) — agent running; README NEAR claims to be re-verified against NEAR_PROOF.md when it lands.
- Final git commit + package report to coordinator.
- Misu-only: GitHub push (public), X demo post, payout NEAR address, form submission — see SUBMISSION_CHECKLIST.md. These are NOT done by the build team (HACKATHON.md: never without the human).
- 19:45 — **NEAR leg LANDED (agent report + docs/NEAR_PROOF.md, all values re-verified from the file):** testnet RPC live (block 277,554,610 at capture); **three testnet accounts CREATED + funded 10 NEAR each** via the legacy helper service — master `omniperps-swarm.testnet` (tx C4W5GTS4UZqKcUkhKfgkEred7WKctGy3axtTsJLZWAa2), `omniperps-agent1-7f3a.testnet` (tx HnqXv26ZRV16tW7Vk8So1SfkddYAfhv4CBXhG7k5Dihy), `omniperps-agent2-7f3a.testnet` (tx s8Pesx8Mqp55STZiog7o7gQvMNPiHmtxwUrQVdhqfan). **Chain Signatures:** epsilon derivation implemented in src/near-proof.js; master EVM address (path ethereum-1, testnet MPC root) `0x28ece91f7e9506d4c6f6a8d36db270d4ec1a688d`, **confirmed byte-identical by v1.signer-prod.testnet's derived_public_key view**. No MPC signature produced (stated plainly). Keys stored OUTSIDE the repo (coordinator-held, 600-perm file), never committed. UI agent cards + README updated to the real accounts.
- 19:46 — **Server /api/near verified live** (collectProof): fresh testnet block 277,554,839 + swarm master state returned.
- 19:46 — **Deployment added:** scripts/build-demo.js builds demo-dist/index.html (43,651 bytes) — src modules + console bundled unmodified for static hosting; bundle executed headlessly in a Node harness: modules load, live Kraken price $68,976 fetched, swarm OPENED a position through the demo shim, kill switch worked via shim. Uploaded to a temporary public file link (expires 2026-11-15T19:46Z) and verified rendering via fetch. Durable hosting = GitHub Pages from the public repo (misu step 1b in SUBMISSION_CHECKLIST).
- 19:47 — README/SUBMISSION_CHECKLIST finalised with real NEAR facts + deployment section; git commit.
