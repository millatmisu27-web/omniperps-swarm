'use strict';
/**
 * Headless end-to-end demo of the full OmniPerps flow:
 *   live price -> swarm opens BTC-PERP (propose/approve/execute)
 *   -> SIMULATED adverse stress -> Risk force-reduces, then force-closes
 *      BEFORE liquidation -> kill switch blocks a new cycle
 *   -> final settlement + agent fee ledger.
 *
 * Run: npm run demo            (live feed)
 *      npm run demo -- --replay (REPLAY mode: recorded REAL Kraken
 *                               candles from data/replay-btc.json —
 *                               zero network dependence)
 * Uses the live feed when reachable; if the network blocks it, falls
 * back to a clearly-labelled scripted price path so the flow can
 * still be verified offline.
 */
const fs = require('node:fs');
const path = require('node:path');
const { PerpEngine } = require('../src/perps');
const { SpendGuard } = require('../src/policy');
const { PriceFeed } = require('../src/pricefeed');
const { ReplayFeed } = require('../src/replayfeed');
const { Swarm } = require('../src/agents');

const line = () => console.log('-'.repeat(72));
const REPLAY = process.argv.includes('--replay');

async function getReplayHistory() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'replay-btc.json'), 'utf8'));
  const feed = new ReplayFeed(data);
  await feed.seedHistory(60);
  const pt = await feed.pollOnce();
  console.log(`REPLAY MODE: ${feed.label()}; history ${feed.history.length} points, now playing $${pt.price}`);
  return { history: feed.history.map(h => ({ price: h.price })), live: false, replay: true, price: pt.price };
}

async function getHistory(feed) {
  try {
    await feed.seedHistory(60);
    const pt = await feed.pollOnce();
    console.log(`LIVE FEED: BTC $${pt.price} via ${pt.source}; history ${feed.history.length} points`);
    return { history: feed.history.map(h => ({ price: h.price })), live: true, price: pt.price };
  } catch (e) {
    console.log(`LIVE FEED UNREACHABLE (${e.message}) — using SIMULATED scripted path (labelled).`);
    let p = 69000; const history = [];
    for (let i = 0; i < 60; i++) { p *= 1 + (Math.sin(i / 5) * 0.0012 + 0.0004); history.push({ price: Math.round(p * 100) / 100 }); }
    return { history, live: false, price: history[history.length - 1].price };
  }
}

(async () => {
  console.log(`OmniPerps Swarm — end-to-end demo${REPLAY ? ' (REPLAY MODE — recorded real prices, no network needed)' : ''}`);
  line();
  const { history, price } = REPLAY ? await getReplayHistory() : await getHistory(new PriceFeed());

  const engine = new PerpEngine({ startingBalance: 100000 });
  const guard = new SpendGuard();
  const swarm = new Swarm({ engine, guard });
  swarm.protectionCooldownMs = 0; // compress time for the CLI demo
  engine.setMarkPrice(price);

  console.log('\nSTEP 1 — decision cycle (Signal proposes, Risk reviews, Execution acts)');
  const res = swarm.runCycle(history, price);
  console.log('  cycle acted:', res.acted, res.why || '');
  if (!engine.position) { console.log('  No position opened (veto or no signal) — demo cannot continue.'); process.exit(1); }
  const entry = engine.position.entryPrice;
  const side = engine.position.side;
  console.log(`  POSITION: ${side} ${engine.position.sizeBtc} BTC @ $${entry}, liq @ $${engine.snapshot().position.liquidationPrice}`);

  console.log('\nSTEP 2 — SIMULATED adverse stress (price path applied to the mark; protection must fire BEFORE liquidation)');
  const adverse = side === 'long' ? -1 : 1;
  let protectionEvents = 0;
  for (let step = 1; step <= 14 && engine.position; step++) {
    const p = Math.round(entry * (1 + adverse * step * 0.015) * 100) / 100; // 1.5% steps to ~21%
    engine.setMarkPrice(p);
    const before = swarm.log.length;
    swarm.onPrice(p);
    const newMsgs = swarm.log.slice(before).filter(m => ['force_reduce', 'force_close', 'liquidation'].includes(m.type));
    for (const m of newMsgs) { console.log(`  @ ${adverse * step * 1.5}%: [${m.type}] ${m.text}`); protectionEvents++; }
  }
  console.log(`  liquidations so far: ${engine.liquidations} (design target: 0 — protection acts first)`);
  if (engine.position) {
    console.log('\nSTEP 2b — position still open after stress; operator closes');
    swarm.closePosition(engine.markPrice, 'demo-cli');
  } else {
    console.log('  position fully closed by Risk protection during the stress.');
  }

  console.log('\nSTEP 3 — kill switch');
  swarm.setKill(true, 'demo-cli');
  const blocked = swarm.runCycle(history, engine.markPrice || price);
  console.log('  cycle while killed acted:', blocked.acted, '(expected false)');
  swarm.setKill(false, 'demo-cli');

  line();
  const snap = engine.snapshot();
  console.log('FINAL ACCOUNT (paper):', JSON.stringify(snap, null, 1));
  console.log('AGENT FEE LEDGER balances:', JSON.stringify(swarm.ledger.balances));
  console.log('GUARD:', JSON.stringify(guard.snapshot()));
  console.log('SETTLEMENT INTENTS produced:', swarm.intents.length);
  console.log('\nSWARM TRANSCRIPT:');
  for (const m of swarm.log) console.log(`  [${m.from} -> ${m.to}] (${m.type}) ${m.text}`);
  const ok = engine.liquidations === 0 && protectionEvents >= 1 && blocked.acted === false;
  console.log(`\nDEMO RESULT: ${ok ? 'PASS — position opened by the swarm, protection acted before liquidation, kill switch blocked trading' : 'CHECK — see transcript above'}`);
  process.exit(ok ? 0 : 2);
})().catch(e => { console.error('DEMO ERROR', e); process.exit(1); });
