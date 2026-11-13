'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SpendGuard } = require('../src/policy');

const baseOrder = { agent: 'execution', side: 'long', sizeBtc: 0.25, leverage: 5, price: 60000, liquidationPrice: 48241, dailyRealisedPnl: 0 };

test('a compliant order is allowed', () => {
  const g = new SpendGuard();
  const r = g.checkOrder(baseOrder); // notional 15000 < 25000, liq distance ~19.6% > 12%
  assert.strictEqual(r.allowed, true);
});

test('oversize notional is vetoed', () => {
  const g = new SpendGuard();
  const r = g.checkOrder({ ...baseOrder, sizeBtc: 1 }); // notional 60000 > cap
  assert.strictEqual(r.allowed, false);
  assert.ok(r.reasons.some(x => x.includes('notional')));
});

test('excess leverage is vetoed', () => {
  const g = new SpendGuard();
  const r = g.checkOrder({ ...baseOrder, leverage: 25, liquidationPrice: 59000 });
  assert.strictEqual(r.allowed, false);
  assert.ok(r.reasons.some(x => x.includes('leverage')));
});

test('fragile liquidation distance is vetoed', () => {
  const g = new SpendGuard();
  const r = g.checkOrder({ ...baseOrder, liquidationPrice: 58000 }); // 3.3% away < 12%
  assert.strictEqual(r.allowed, false);
  assert.ok(r.reasons.some(x => x.includes('liquidation distance')));
});

test('kill switch vetoes everything and is logged', () => {
  const g = new SpendGuard();
  g.setKill(true, 'test');
  const r = g.checkOrder(baseOrder);
  assert.strictEqual(r.allowed, false);
  assert.ok(r.reasons.some(x => x.includes('KILL SWITCH')));
  g.setKill(false, 'test');
  assert.strictEqual(g.checkOrder(baseOrder).allowed, true);
});

test('daily loss breach is vetoed', () => {
  const g = new SpendGuard();
  const r = g.checkOrder({ ...baseOrder, dailyRealisedPnl: -6000 });
  assert.strictEqual(r.allowed, false);
});

test('every check is written to the audit log', () => {
  const g = new SpendGuard();
  g.checkOrder(baseOrder);
  g.checkOrder({ ...baseOrder, sizeBtc: 5 });
  assert.strictEqual(g.log.length, 2);
  assert.strictEqual(g.snapshot().vetoes, 1);
});
