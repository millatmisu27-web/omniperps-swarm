# Demo video script — OmniPerps Swarm (60–90 seconds)

**Format:** screen recording of the console (`npm start` → http://localhost:4173) with voiceover or captions. One complete moment: an order flows through the swarm, then the swarm saves itself.

**Before recording:** start the server, wait ~15 seconds so the swarm has opened a position on the live price. Keep the decision log visible.

| Time | Shot | Narration / caption |
|---|---|---|
| 0:00–0:08 | Console wide shot, live price ticking | "This is OmniPerps Swarm: three AI agents trading a Bitcoin perpetual — on live prices. No single agent can move money alone." |
| 0:08–0:25 | Decision log close-up: propose → approve → executed | "The Signal Agent proposes a trade and shows its reasoning. The Risk Agent — independent — checks it against hard policy limits and can veto. Only then can Execution place the order." |
| 0:25–0:35 | Position panel + liquidation gauge | "The position is live: margin, PnL, and exactly how far it is from liquidation. The agents earn fees per task — that's their ledger." |
| 0:35–0:55 | Click **Stress test**; watch the log | "Now we attack it: a simulated 18% crash against the position. Watch the Risk Agent — it cuts the position in half, again, then closes it entirely — before liquidation. Zero liquidations." |
| 0:55–1:10 | Click **KILL SWITCH**, then "Run decision cycle" | "And the human always wins: one kill switch, and every agent halts. The blocked cycle is written to the audit log." |
| 1:10–1:25 | Guard panel + NEAR panel | "All of it bounded by a NEAR-anchored SpendGuard on testnet — per-agent limits, sub-accounts for each agent, and a settlement intent for every trade. Give AI a trading desk — never the keys to the vault." |
| 1:25–1:30 | End card | "OmniPerps Swarm — built at NEAR HACKATHON. Repo + live demo linked." |

**Shot tips (from HACKATHON.md):** lead with the problem (first line above does), show one complete moment (the stress save), explain NEAR's role concretely (guard + sub-accounts + intents), end with a next step (repo link + a question in the post text).
