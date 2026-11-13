# OmniPerps Swarm

**Give AI a trading desk — but never the keys to the vault.** A three-agent swarm (Signal, Risk, Execution) trades a BTC perpetual on live prices. Signal proposes, Risk can veto, Execution acts only with an approval — and a NEAR-anchored SpendGuard policy with a global kill switch bounds everything the swarm can do.

Built at **NEAR HACKATHON** (Nov 2026). Tracks: **Unstoppable DeFi** (primary) · **AI Swarms** · **Agent Economy** · **AI Security & Defense**.

## The problem

Autonomous trading agents are easy to build and dangerous to trust: one bad model call can size a position that liquidates the account, and there is no independent check between "the AI decided" and "the money moved". OmniPerps Swarm separates the desk into three agents with opposed incentives, and puts a policy engine — not a prompt — between decision and execution.

## What it does

- **Live-market perps engine (BTC-PERP):** real BTC/USD prices from public feeds (Kraken → Coinbase → CoinGecko fallback chain), correct isolated-margin math: required margin, unrealised PnL, maintenance margin, liquidation price. Settlement is **paper** (see "Live vs simulated" below).
- **Signal Agent** watches the live feed (EMA momentum) and proposes trades *with its reasoning shown*.
- **Risk Agent** is independent: it re-checks every proposal against the SpendGuard policy and the live liquidation distance. It can **approve, halve, or veto** — and on an open position it **force-reduces and force-closes before liquidation** (protection at <12% distance, force-close at <7%).
- **Execution Agent** is the only agent that can touch the engine, and only with a Risk approval; it re-checks the guard itself immediately before acting.
- **Agent Economy:** agents earn per completed task from a protocol fee pool (Signal per executed proposal, Risk per review + protection bonus, Execution per order) in a visible fee ledger — the swarm's internal labour market.
- **SpendGuard (AI Security):** per-order notional cap ($25k), leverage ceiling (10x), minimum liquidation distance (12%), daily loss limit ($5k) — and a **global kill switch** that halts all agents instantly. Every check, pass or veto, is written to an audit log.
- **NEAR layer (live, with proof):** three swarm accounts were **created and funded on NEAR testnet** — master `omniperps-swarm.testnet` + two agent accounts, 10 NEAR each, creation tx hashes in **docs/NEAR_PROOF.md** — and all state is read via plain JSON-RPC in `src/near-proof.js` (zero dependencies). Using NEAR Chain Signatures' official epsilon derivation, the swarm master deterministically controls EVM address **`0x28ece91f7e9506d4c6f6a8d36db270d4ec1a688d`** (path `ethereum-1`) — a derivation the live testnet MPC contract (`v1.signer-prod.testnet`) confirms byte-for-byte via its own `derived_public_key` view. **A real MPC signature has since been requested from that contract and cryptographically verified**: ecrecover over the signed demo payload reproduces exactly that EVM address (sign tx `E9TZrQ3wVWFSoED61XKi1HowPi6w4XB5fDnMykWZpX8b`; reproduce with `node scripts/mpc-proof.js`). The **SpendGuard policy is also deployed as a real NEAR testnet contract** (`guard.omniperps-swarm.testnet`, near-sdk-js) mirroring `src/policy.js`, and is exercised live — in-limit allowed, oversize denied, kill switch denies (reproduce with `node scripts/guard-proof.js`). Every executed order also produces a **NEAR Intents-style settlement intent** (`token_diff`). Honest limits: no intent has been executed on Intents mainnet, and no EVM transaction has been broadcast from the derived address.

```
                 live BTC feed (Kraken/Coinbase/CoinGecko)
                               │
                        ┌──────▼──────┐
                        │   SIGNAL    │  proposes trade + reason
                        └──────┬──────┘
                               ▼
   SpendGuard policy ──►  ┌─────────┐   veto = final
   (caps, kill switch)    │   RISK  │   force-reduce / force-close
                        └──────┬──────┘
                               ▼ approved only
                        ┌────────────┐      ┌──────────────────┐
                        │ EXECUTION  │─────►│  PerpEngine      │
                        └────────────┘      │  (paper settle,  │
                               │            │   live prices)   │
                               ▼            └──────────────────┘
                    settlement intent (NEAR Intents-style)
                    + fee ledger payment to each agent
```

## For judges — do X, see Y

Prerequisite: Node.js ≥ 18. **No dependencies to install** (zero-dependency by design).

1. **Run the test suite** — `npm test`
   → *See:* 21/21 tests pass — margin & liquidation math, PnL, policy vetoes (oversize, leverage, fragile liquidation distance, kill switch), and the full swarm protection flow.
2. **Run the headless end-to-end demo** — `npm run demo`
   → *See:* the swarm reads the **live** BTC price, opens a BTC-PERP position through propose → approve → execute (printed transcript), a labelled simulated stress then drives the price against the position and the **Risk Agent force-reduces and force-closes before any liquidation** (liquidations: 0), the **kill switch blocks** a further cycle, and the final paper account + agent fee ledger print.
3. **Open the swarm console** — `npm start`, then visit `http://localhost:4173`
   → *See:* live price chart (real feed, source labelled), the swarm auto-trading, position/PnL/liquidation-distance gauge, agent cards with ledger earnings, the full decision log, and the guard panel.
4. **In the console, click "Stress test"** while a position is open
   → *See:* a clearly-labelled simulated adverse move (~−18%) on top of the live anchor; Risk protection fires in the log; the position is cut down and closed **before** the liquidation price.
5. **Click "KILL SWITCH"**, then "Run decision cycle"
   → *See:* the cycle is blocked and logged; no agent can trade until the switch is released.
6. **Read the NEAR proof** — `docs/NEAR_PROOF.md`
   → *See:* real NEAR testnet RPC reads captured from the network, the chain-signatures derivation status, and an explicit list of what is **not** done.
7. **Verify the real MPC signature** — `node scripts/mpc-proof.js`
   → *See:* the script re-fetches the sign transaction (`E9TZrQ3wVWFSoED61XKi1HowPi6w4XB5fDnMykWZpX8b`) live from testnet RPC, extracts the signature the MPC network returned, and verifies it — ECDSA against the derived public key **and** Ethereum ecrecover — concluding `MPC SIGNATURE VERIFIED ... 0x28ece91f7e9506d4c6f6a8d36db270d4ec1a688d`.
8. **Exercise the deployed SpendGuard contract** — `node scripts/guard-proof.js`
   → *See:* the live state of `guard.omniperps-swarm.testnet` read from testnet. With the demo keys file (coordinator-held, outside the repo) it also runs the signed checks: in-limit → allowed, oversize → denied, kill switch on → denied, then off again.

## Live vs simulated — stated plainly

| Piece | Status |
|---|---|
| BTC/USD prices | **LIVE** — Kraken public API (Coinbase, CoinGecko fallbacks). Binance/Bybit are geo-blocked from the build environment and are not used. Price history seeds from real Kraken 1-minute candles. |
| Perps settlement | **SIMULATED (paper)** — a $100,000 paper account. No real funds, no real exchange. The margin/liquidation math is real and unit-tested. |
| Stress test | **SIMULATED overlay** on the live price, always labelled in UI and logs. It exists so protection can be demonstrated on demand. |
| Agent decisions | **REAL logic, running live** — EMA signal, independent risk review, guard checks, fee ledger. No LLM calls; the agents are deterministic policy-driven programs (auditable by design). |
| NEAR testnet | **LIVE** — three swarm accounts created + funded on testnet (10 NEAR each; creation tx hashes in docs/NEAR_PROOF.md); state read live via JSON-RPC (`src/near-proof.js`, also served at `/api/near` in the console). |
| Chain Signatures | **SIGNATURE PRODUCED + VERIFIED** — the master's EVM address for path `ethereum-1` is derived client-side with the official epsilon derivation and confirmed byte-identical by the testnet MPC contract's `derived_public_key` view; then a **real `sign` request** was submitted to `v1.signer-prod.testnet` (tx `E9TZrQ3wVWFSoED61XKi1HowPi6w4XB5fDnMykWZpX8b`) and the returned signature **verifies**: ecrecover over the signed payload (sha256 of a labelled demo message) reproduces the derived address. Reproduce: `node scripts/mpc-proof.js`. The signature was over a demo payload digest — no EVM transaction has been broadcast from the derived address. |
| SpendGuard contract | **DEPLOYED on testnet** — `guard.omniperps-swarm.testnet` (near-sdk-js, source in `contracts/spendguard/`), state mirroring `src/policy.js` exactly, owner = swarm master. Live checks proven on-chain: in-limit allowed, oversize denied, kill switch denies (tx hashes in docs/NEAR_PROOF.md; reproduce: `node scripts/guard-proof.js`). The swarm's runtime enforcement is still the identical off-chain module by default; the server can log one live contract read per cycle with `OMNIPERPS_GUARD_CHAIN=1`. |
| NEAR Intents | The swarm **produces** an Intents-style `token_diff` settlement intent per executed order. It is **not executed** on Intents mainnet (Intents has no testnet — HACKATHON.md Q-007). |

## Deployment

- **Public repository (required home):** this folder is a push-ready git repo. The owner pushes it to a **public GitHub repository** (their account — see SUBMISSION_CHECKLIST.md step 1) before the deadline; judges run it from there with the steps above.
- **Live hosted demo (no install):** `demo-dist/index.html` is a single self-contained page — the *same* engine, policy and swarm modules running in the browser on the same live price feeds, in a clearly-labelled **hosted demo mode** (banner in the UI). Build it with `node scripts/build-demo.js`; host it free on GitHub Pages / Netlify / Vercel by publishing the `demo-dist` folder.
  - A temporary hosted copy is live at: https://muse.ai/files/1322723147599917/1703605014822200/9gokflv8412se9mio8pn0eyp/index.html — **this link expires 2026-11-15T19:46Z** (file-host link, not permanent hosting). The durable judging link is the GitHub Pages copy from the public repo.
  - In hosted demo mode the NEAR panel does a live testnet RPC status read directly from the browser; the full proof set is docs/NEAR_PROOF.md.
- **Full stack:** `npm start` (zero dependencies) serves the same console with the server-side NEAR proof module at `http://localhost:4173`.

## Tech

Node.js (zero dependencies) · NEAR testnet JSON-RPC · Kraken/Coinbase/CoinGecko public APIs · NEAR Chain Signatures (derivation **and a real, verified MPC signature** — see proof doc) · SpendGuard contract in TypeScript on near-sdk-js (tooling-only deps, under `contracts/`) · NEAR Intents-style settlement intents · `node:test` suite.

## Layout

```
server.js            dashboard + API (zero-dep http)
public/              swarm console (chart, agents, guard, logs, NEAR panel)
src/perps.js         PerpEngine — margin / PnL / liquidation math
src/policy.js        SpendGuard — limits, vetoes, kill switch, audit log
src/agents.js        Signal / Risk / Execution + fee ledger + intents
src/pricefeed.js     live price feed with source fallback chain
src/near-proof.js    NEAR testnet RPC reads + derivation (see docs/NEAR_PROOF.md)
src/near-tx.js       minimal signed-transaction client (Borsh + Ed25519, built-ins only)
src/guard-chain.js   optional live read of the on-chain SpendGuard per cycle (env flag)
contracts/spendguard/  SpendGuard contract (near-sdk-js) deployed to guard.omniperps-swarm.testnet
scripts/demo-cli.js  headless end-to-end demo (npm run demo)
scripts/mpc-proof.js   verify the real MPC signature against the live sign tx (zero-dep)
scripts/guard-proof.js exercise the deployed SpendGuard contract live (zero-dep)
tools/near-tools/      tooling-only scripts (near-api-js): mpc-sign.js, deploy-guard.js
tests/               21 tests (npm test)
TESTS.md             captured test + demo output
DEMO_SCRIPT.md       60–90s demo video script for the X post
SUBMISSION_CHECKLIST.md  the remaining human-only submission steps
BUILD_LOG.md         what was built and verified, with timestamps
```

## Safety & honesty notes

- Demo/testnet only. The paper account cannot lose real money; the guard limits are set for the demo and are visible in the UI.
- No secrets in this repo: **no private keys are committed**. The demo testnet keys live in a coordinator-held file *outside* the repo (mode 600) and are used only by the tooling/proof scripts (`tools/near-tools/`, `scripts/guard-proof.js`) to sign testnet transactions. Testnet funds have zero real-world value.
- This is a hackathon prototype, not financial advice and not a production trading system.

## License

MIT (see LICENSE).
