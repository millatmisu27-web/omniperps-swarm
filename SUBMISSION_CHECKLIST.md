# Submission checklist — OmniPerps Swarm (NEAR HACKATHON)

Deadline: **14 Nov 2026, 23:59 UTC** (15 Nov 05:59 in Dhaka). Everything below is a step **only misu can do** (his accounts, his confirmation) — per HACKATHON.md, the submission, the X post, and making the repo public must never happen without the human's explicit confirmation.

## Already done by the build team
- [x] Working prototype: engine, swarm, guard, dashboard (`npm test` 27/27, `npm run demo` PASS live + `-- --replay` offline — see TESTS.md)
- [x] Wave 2: on-chain fee settlement (real testnet transfers, docs/NEAR_PROOF.md §7), dual LIVE ⇄ REPLAY demo, GitHub Actions CI (activates on push), console screenshots in README, protection backtest (docs/BACKTEST.md)
- [x] README with judge steps ("do X, see Y"), live-vs-simulated table, architecture
- [x] DEMO_SCRIPT.md for the X video
- [x] This checklist with paste-ready texts

## Misu's steps, in order
1. **GitHub account + create a repo and push this folder** (make it public before the deadline).
   ⚠️ OPEN QUESTION: whose GitHub account the repo lives under is not yet decided. If you don't have a GitHub account (or aren't signed in), create/sign in first — the build team cannot create an account for you or use anyone else's credentials. Suggested repo name: `omniperps-swarm`. Do not rename files inside.
   After pushing, the intended public URL is `https://github.com/<your-username>/omniperps-swarm`.
1b. **Turn on the live demo (GitHub Pages):** in the repo → Settings → Pages → deploy from the branch you pushed, folder `/demo-dist` (if that folder option isn't offered, pick the branch root and the demo is at `/demo-dist/`). Your durable demo link becomes `https://<your-username>.github.io/omniperps-swarm/demo-dist/` — keep this link; the temporary hosted copy in the README expires 2026-11-15.
2. **Record the demo video** (60–90 s) following DEMO_SCRIPT.md — screen-record the console at http://localhost:4173 while running `npm start`.
3. **Post the demo on X** from your account with the video attached. Paste-ready text:

   > AI trading agents are easy to build and dangerous to trust — one bad call can liquidate the account.
   >
   > So I built OmniPerps Swarm at #NEARHackathon: Signal proposes, an independent Risk Agent can veto, Execution acts only with approval — and a NEAR-guarded kill switch bounds them all.
   >
   > Watch the Risk Agent save the position before liquidation 👇
   >
   > Repo + demo: <PASTE REPO LINK>
   > What limit would YOU set for an AI trading with real money?
   >
   > @NEARProtocol #NEARHackathon

   (Keep @NEARProtocol and #NEARHackathon in the post — required. Copy the X post link.)
4. **Your NEAR payout address (mainnet)** — a named account like `yourname.near` from your NEAR wallet. The team must never invent one; prizes are paid to this address.
5. **Submit the form** at https://nearhackathon.com/#apply (or the API — the form is simpler) with:
   - Project name: `OmniPerps Swarm`
   - Team lead: your name; Email: yours; Team size: `1` (adjust if team)
   - Tracks: `defi`, `swarms`, `agents`, `security`  (Unstoppable DeFi · AI Swarms · Agent Economy · AI Security & Defense)
   - NEAR address: from step 4
   - Repository link: from step 1
   - Demo post link: from step 3
   - Description (paste-ready, ~950 chars):

     > Problem: autonomous trading agents can move from "AI decided" to "money moved" with no independent check — one bad call can liquidate an account. OmniPerps Swarm splits the desk into three NEAR-anchored agents with opposed incentives: a Signal Agent proposes BTC-PERP trades on live prices with its reasoning shown; an independent Risk Agent checks every proposal against a SpendGuard policy (per-order notional cap, leverage ceiling, minimum liquidation distance, daily loss limit) and can veto, halve, force-reduce or force-close before liquidation; an Execution Agent acts only with Risk approval and re-checks the guard itself. Agents earn per-task fees in a visible ledger (Agent Economy) — and the ledger settles on-chain: earnings were paid from the swarm master as real NEAR testnet transfers (Signal 0.02 NEAR, Risk 0.215 NEAR at a stated 0.01 NEAR per ledger unit; tx hashes in docs/NEAR_PROOF.md). The demo works online and offline: LIVE prices by default, with an automatic, banner-labelled fallback to REPLAY (recorded real Kraken candles) when the feed is unreachable, plus a manual toggle. A backtest on the real Jan–Feb 2026 BTC drawdown (−36.72%) shows the unprotected position liquidated (−100% of margin) versus the swarm-protected path exiting via the Risk ladder at −48.7% of margin (docs/BACKTEST.md). The agents trade under real NEAR testnet accounts created for the swarm, every executed order produces a NEAR Intents-style settlement intent, and a global kill switch halts the swarm instantly. Via NEAR Chain Signatures the swarm master controls an EVM address — and the MPC network has really signed for it: a signature requested on testnet was returned and verified in code (ecrecover equals the derived address; see docs/NEAR_PROOF.md). SpendGuard is also deployed as a real NEAR testnet contract (guard.omniperps-swarm.testnet) and exercised live: in-limit orders allowed, oversize orders denied, kill switch enforced. Settlement of the perps book is paper on live prices; margin/liquidation math is unit-tested (27 tests, CI on push). Judges: npm test, npm run demo (or -- --replay offline), npm start.

   - Tick the consent checkbox ("I agree that the organizers may use these details to review our submission and contact us about this hackathon.")
6. **Submit ONCE.** If anything is wrong afterwards, do NOT submit again — use https://nearhackathon.com/request-changes.

## Notes
- Testnet projects are fully eligible (HACKATHON.md Q-010); Intents has no testnet, which is why settlement intents are produced, not executed (Q-007) — the README states this plainly.
- Keep the repo public through judging (results by 18 Nov 23:59 UTC).
