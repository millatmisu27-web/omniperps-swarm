'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { PerpEngine, MMR } = require('../src/perps');

test('margin required = notional / leverage', () => {
  const e = new PerpEngine({});
  assert.strictEqual(e.requiredMargin(0.5, 60000, 5), 6000);
  assert.strictEqual(e.requiredMargin(1, 80000, 10), 8000);
});

test('open position locks margin + fee, exposes liquidation price', () => {
  const e = new PerpEngine({ startingBalance: 100000 });
  const opened = e.openPosition({ side: 'long', sizeBtc: 0.25, leverage: 5, price: 60000 });
  // notional 15000, margin 3000, fee 7.5
  assert.strictEqual(opened.margin, 3000);
  assert.ok(Math.abs(e.walletBalance - (100000 - 3000 - 7.5)) < 1e-9);
  // liq long = entry*(1-1/L)/(1-mmr) = 60000*0.8/0.995
  assert.ok(Math.abs(opened.liquidationPrice - 60000 * 0.8 / (1 - MMR)) < 1e-6);
});

test('unrealised PnL long and short', () => {
  const long = new PerpEngine({});
  long.openPosition({ side: 'long', sizeBtc: 0.5, leverage: 5, price: 60000 });
  long.setMarkPrice(63000);
  assert.strictEqual(long.unrealisedPnl(), 1500);
  const short = new PerpEngine({});
  short.openPosition({ side: 'short', sizeBtc: 0.5, leverage: 5, price: 60000 });
  short.setMarkPrice(63000);
  assert.strictEqual(short.unrealisedPnl(), -1500);
});

test('short liquidation price is above entry', () => {
  const e = new PerpEngine({});
  const liq = e.liquidationPrice('short', 60000, 5);
  assert.ok(liq > 60000);
  assert.ok(Math.abs(liq - 60000 * 1.2 / (1 + MMR)) < 1e-6);
});

test('close realises PnL and returns margin minus fee', () => {
  const e = new PerpEngine({ startingBalance: 100000 });
  e.openPosition({ side: 'long', sizeBtc: 0.5, leverage: 5, price: 60000 });
  const r = e.closePosition(66000, 1);
  assert.strictEqual(r.pnl, 3000);
  assert.strictEqual(e.position, null);
  assert.ok(e.walletBalance > 100000); // profit minus two fees
  assert.strictEqual(e.realisedPnlTotal, 3000);
});

test('partial close reduces size and margin proportionally', () => {
  const e = new PerpEngine({});
  e.openPosition({ side: 'long', sizeBtc: 1, leverage: 5, price: 60000 });
  e.closePosition(60000, 0.5);
  assert.strictEqual(e.position.sizeBtc, 0.5);
  assert.strictEqual(e.position.margin, 6000);
});

test('liquidation fires when equity hits maintenance margin', () => {
  const e = new PerpEngine({ startingBalance: 100000 });
  e.openPosition({ side: 'long', sizeBtc: 0.5, leverage: 5, price: 60000 });
  const liq = e.snapshot().position.liquidationPrice;
  const ev = e.setMarkPrice(Math.floor(liq) - 10);
  assert.ok(ev && ev.type === 'liquidation');
  assert.strictEqual(e.position, null);
  assert.strictEqual(e.liquidations, 1);
});

test('insufficient collateral is rejected', () => {
  const e = new PerpEngine({ startingBalance: 1000 });
  assert.throws(() => e.openPosition({ side: 'long', sizeBtc: 1, leverage: 2, price: 60000 }), /insufficient/);
});

test('second concurrent position is rejected', () => {
  const e = new PerpEngine({});
  e.openPosition({ side: 'long', sizeBtc: 0.1, leverage: 5, price: 60000 });
  assert.throws(() => e.openPosition({ side: 'short', sizeBtc: 0.1, leverage: 5, price: 60000 }), /already open/);
});
