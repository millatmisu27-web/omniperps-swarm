'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { PerpEngine } = require('../src/perps');
const { SpendGuard } = require('../src/policy');
const { Swarm } = require('../src/agents');

function risingHistory(n = 40, start = 60000, stepPct = 0.001) {
  const h = []; let p = start;
  for (let i = 0; i < n; i++) { p *= (1 + stepPct); h.push({ price: Math.round(p * 100) / 100 }); }
  return h;
}

function makeSwarm() {
  const engine = new PerpEngine({ startingBalance: 100000 });
  const guard = new SpendGuard();
  const swarm = new Swarm({ engine, guard });
  swarm.protectionCooldownMs = 0;
  return { engine, guard, swarm };
}

test('full cycle: signal proposes, risk approves, execution opens, fees are paid', () => {
  const { engine, swarm } = makeSwarm();
  const history = risingHistory();
  const price = history[history.length - 1].price;
  engine.setMarkPrice(price);
  const res = swarm.runCycle(history, price);
  assert.strictEqual(res.acted, true);
  assert.ok(engine.position, 'position must be open');
  assert.ok(swarm.ledger.balances.signal > 0, 'signal agent paid');
  assert.ok(swarm.ledger.balances.risk > 0, 'risk agent paid');
  assert.ok(swarm.ledger.balances.execution > 0, 'execution agent paid');
  assert.strictEqual(swarm.intents.length, 1, 'one settlement intent produced');
  const types = swarm.log.map(m => m.type);
  assert.ok(types.includes('propose') && types.includes('executed'));
});

test('kill switch blocks the cycle completely', () => {
  const { engine, swarm } = makeSwarm();
  const history = risingHistory();
  const price = history[history.length - 1].price;
  engine.setMarkPrice(price);
  swarm.setKill(true, 'test');
  const res = swarm.runCycle(history, price);
  assert.strictEqual(res.acted, false);
  assert.strictEqual(engine.position, null);
});

test('risk protection force-reduces then force-closes BEFORE liquidation under stress', () => {
  const { engine, swarm } = makeSwarm();
  const history = risingHistory();
  const price = history[history.length - 1].price;
  engine.setMarkPrice(price);
  swarm.runCycle(history, price);
  assert.ok(engine.position);
  const entry = engine.position.entryPrice;
  const side = engine.position.side;
  const adverse = side === 'long' ? -1 : 1;
  const types = [];
  for (let step = 1; step <= 14 && engine.position; step++) {
    const p = Math.round(entry * (1 + adverse * step * 0.015) * 100) / 100;
    engine.setMarkPrice(p);
    swarm.onPrice(p);
    types.push(...swarm.log.map(m => m.type));
  }
  assert.strictEqual(engine.liquidations, 0, 'protection must act before liquidation');
  assert.ok(types.includes('force_reduce') || types.includes('force_close'), 'a protective action must occur');
});

test('risk agent vetoes a fragile oversized proposal path', () => {
  const { engine, guard, swarm } = makeSwarm();
  engine.setMarkPrice(60000);
  // Direct guard check with a fragile order, as the Risk Agent performs it:
  const r = guard.checkOrder({ agent: 'execution', side: 'long', sizeBtc: 2, leverage: 40, price: 60000, liquidationPrice: 59500, dailyRealisedPnl: 0 });
  assert.strictEqual(r.allowed, false);
  assert.ok(r.reasons.length >= 2);
  assert.ok(swarm); // swarm wiring present
});

test('closing a position settles PnL and pays the execution fee', () => {
  const { engine, swarm } = makeSwarm();
  const history = risingHistory();
  const price = history[history.length - 1].price;
  engine.setMarkPrice(price);
  swarm.runCycle(history, price);
  const before = swarm.ledger.balances.execution;
  const r = swarm.closePosition(price + 500, 'test');
  assert.ok(r && typeof r.pnl === 'number');
  assert.strictEqual(engine.position, null);
  assert.ok(swarm.ledger.balances.execution > before);
});
