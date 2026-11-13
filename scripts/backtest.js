'use strict';
/**
 * OmniPerps Swarm — protection backtest on REAL historical prices.
 *
 * Question this answers with numbers: when BTC falls off a cliff,
 * what does the Risk Agent's protection ladder actually save versus
 * holding the same position unprotected? Same entry, same prices,
 * same engine — the ONLY difference is whether Swarm.onPrice (the
 * live protection code) runs.
 *
 * Methodology (stated plainly; also in docs/BACKTEST.md):
 *  - Data: Kraken public OHLC, pair XBTUSD, interval 1440 (daily
 *    candles), fetched live by this script.
 *  - Window: the sharpest peak-to-trough drawdown (running peak HIGH
 *    to a later LOW) completing within <= 21 days, among candles
 *    dated >= 2024-01-01. Selected by rule, not by hand.
 *  - Entry: LONG at the CLOSE of the peak day. Size = the swarm's
 *    own standard proposal sizing (~$18k notional target, 5x)
 *    passed through RiskAgent.review() — which may halve it —
 *    identical for both paths. The entry isolates the protection
 *    layer (the product claim under test); it is not a claim that
 *    the Signal Agent would have bought the exact top.
 *  - Stepping: for each daily candle after entry, up to and
 *    including the trough day, the mark is set to the candle LOW
 *    first (worst adverse print of the day for a long), then to the
 *    candle CLOSE. Liquidation is checked by the engine at every
 *    mark in both paths. Path B (protected) also calls
 *    Swarm.onPrice(mark) at every mark. Intra-candle path is
 *    approximated by low -> close.
 *  - End: any position still open at the trough day's close is
 *    closed there. Engine taker fees apply in both paths.
 *
 * Outputs: docs/backtest-run.json (raw results), the chart via
 * scripts/render-backtest-chart.py -> docs/images/backtest.png,
 * and a summary on stdout. Docs: docs/BACKTEST.md.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PerpEngine } = require('../src/perps');
const { SpendGuard } = require('../src/policy');
const { Swarm, RiskAgent } = require('../src/agents');

const ROOT = path.join(__dirname, '..');

async function fetchDaily() {
  const r = await fetch('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440', { headers: { 'user-agent': 'omniperps-swarm/0.1' } });
  if (!r.ok) throw new Error(`Kraken OHLC HTTP ${r.status}`);
  const j = await r.json();
  return j.result.XXBTZUSD.map(c => ({
    ts: c[0] * 1000, date: new Date(c[0] * 1000).toISOString().slice(0, 10),
    open: +c[1], high: +c[2], low: +c[3], close: +c[4],
  })).filter(c => c.ts >= Date.UTC(2024, 0, 1));
}

function selectWindow(candles) {
  let best = null;
  for (let i = 0; i < candles.length; i++) {
    for (let k = i; k < Math.min(i + 21, candles.length); k++) {
      const dd = (candles[k].low - candles[i].high) / candles[i].high * 100;
      if (!best || dd < best.dropPct) best = { peakIdx: i, troughIdx: k, dropPct: dd };
    }
  }
  return best;
}

function runPath(candles, win, entry, sizeBtc, { protectedPath }) {
  const engine = new PerpEngine({ startingBalance: 100000 });
  const guard = new SpendGuard();
  const swarm = new Swarm({ engine, guard });
  swarm.protectionCooldownMs = 0; // protection evaluated at every mark (stated in methodology)
  engine.setMarkPrice(entry);
  engine.openPosition({ side: 'long', sizeBtc, leverage: 5, price: entry });
  const margin = engine.position.margin;
  const events = [];
  const equityCurve = [{ date: candles[win.peakIdx].date, price: entry, equity: engine.equity(entry) }];
  let liquidated = null;

  for (let k = win.peakIdx + 1; k <= win.troughIdx; k++) {
    const c = candles[k];
    for (const mark of [c.low, c.close]) {
      const liqBefore = engine.liquidations;
      engine.setMarkPrice(mark);
      if (protectedPath) swarm.onPrice(mark);
      if (engine.liquidations > liqBefore && !liquidated) {
        liquidated = { date: c.date, price: mark };
        events.push({ type: 'liquidation', date: c.date, price: mark });
      }
    }
    // capture protection events recorded by the engine at this candle
    for (const ev of engine.events) {
      if (ev._seen) continue; ev._seen = true;
      if (ev.type === 'reduce' || ev.type === 'close') {
        events.push({ type: ev.type === 'reduce' ? 'force_reduce' : 'force_close', date: c.date, price: ev.price, pnl: Math.round(ev.pnl * 100) / 100 });
      }
    }
    equityCurve.push({ date: c.date, price: c.close, equity: Math.round(engine.equity(c.close) * 100) / 100 });
    if (!engine.position) break;
  }
  let finalClose = null;
  if (engine.position) {
    const last = candles[Math.min(win.troughIdx, candles.length - 1)];
    engine.setMarkPrice(last.close);
    if (protectedPath) { const r = swarm.closePosition(last.close, 'backtest-end'); finalClose = { date: last.date, price: last.close, pnl: Math.round(r.pnl * 100) / 100 }; }
    else { const r = engine.closePosition(last.close, 1); finalClose = { date: last.date, price: last.close, pnl: Math.round(r.pnl * 100) / 100 }; }
    equityCurve.push({ date: last.date, price: last.close, equity: Math.round(engine.equity(last.close) * 100) / 100 });
  }
  const snap = engine.snapshot();
  return {
    protected: protectedPath,
    liquidated,
    events: events.filter(e => e.type !== 'liquidation' || true),
    finalClose,
    marginCommitted: Math.round(margin * 100) / 100,
    finalWallet: snap.walletBalance,
    realisedPnlTotal: snap.realisedPnlTotal,
    feesPaidTotal: snap.feesPaidTotal,
    liquidations: snap.liquidations,
    equityCurve,
  };
}

(async () => {
  const candles = await fetchDaily();
  const win = selectWindow(candles);
  const peak = candles[win.peakIdx];
  const trough = candles[win.troughIdx];
  const entry = peak.close;

  // The swarm's own sizing machinery decides the identical entry size.
  const sizingEngine = new PerpEngine({ startingBalance: 100000 });
  sizingEngine.setMarkPrice(entry);
  const proposal = { side: 'long', sizeBtc: Math.round((18000 / entry) * 10000) / 10000, leverage: 5, price: entry };
  const review = new RiskAgent().review(proposal, sizingEngine, new SpendGuard());
  if (review.verdict === 'veto') throw new Error(`entry proposal vetoed by Risk review: ${review.reasons.join('; ')}`);

  const a = runPath(candles, win, entry, review.sizeBtc, { protectedPath: false });
  const b = runPath(candles, win, entry, review.sizeBtc, { protectedPath: true });

  const result = {
    generatedAt: new Date().toISOString(),
    dataSource: 'Kraken public OHLC, XBTUSD, interval 1440 (daily)',
    window: {
      peakDate: peak.date, peakHigh: peak.high, entryClose: entry,
      troughDate: trough.date, troughLow: trough.low,
      dropPct: Math.round(win.dropPct * 100) / 100,
      days: win.troughIdx - win.peakIdx,
    },
    entry: { side: 'long', sizeBtc: review.sizeBtc, leverage: 5, riskVerdict: review.verdict, liquidationPrice: Math.round(review.liquidationPrice * 100) / 100 },
    unprotected: a,
    protected: b,
    chartWindow: candles.slice(Math.max(0, win.peakIdx - 7), win.troughIdx + 3).map(c => ({ date: c.date, close: c.close, high: c.high, low: c.low })),
  };
  fs.writeFileSync(path.join(ROOT, 'docs', 'backtest-run.json'), JSON.stringify(result, null, 2));

  console.log(`Window: peak ${peak.date} (high $${peak.high}, entry close $${entry}) -> trough ${trough.date} (low $${trough.low}) = ${result.window.dropPct}% in ${result.window.days} days`);
  console.log(`Entry: LONG ${review.sizeBtc} BTC @ $${entry} x5 (Risk verdict: ${review.verdict}), margin $${a.marginCommitted}, liq @ $${result.entry.liquidationPrice}`);
  console.log(`UNPROTECTED: ${a.liquidated ? `LIQUIDATED on ${a.liquidated.date} @ $${a.liquidated.price}` : 'survived'} — realised PnL $${a.realisedPnlTotal}, final wallet $${a.finalWallet}`);
  console.log(`PROTECTED:   ${b.liquidated ? `LIQUIDATED on ${b.liquidated.date} @ $${b.liquidated.price}` : 'no liquidation'} — events: ${b.events.map(e => `${e.type}@${e.date}`).join(', ') || 'none'} — realised PnL $${b.realisedPnlTotal}, final wallet $${b.finalWallet}`);

  try {
    execFileSync('python3', [path.join(ROOT, 'scripts', 'render-backtest-chart.py')], { stdio: 'inherit' });
  } catch (e) {
    console.log('CHART: python renderer unavailable — docs/backtest-run.json holds the data; render docs/images/backtest.png when PIL/matplotlib is present.');
  }
  console.log('Wrote docs/backtest-run.json');
})().catch(e => { console.error('BACKTEST ERROR', e); process.exit(1); });
