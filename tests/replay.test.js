'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ReplayFeed } = require('../src/replayfeed');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'replay-btc.json'), 'utf8'));

test('replay data is recorded real Kraken candles with honest metadata', () => {
  assert.equal(DATA.meta.source.includes('Kraken'), true);
  assert.equal(DATA.meta.interval_minutes, 1);
  assert.ok(DATA.candles.length >= 600, `expected several hours of 1m candles, got ${DATA.candles.length}`);
  assert.equal(DATA.meta.candle_count, DATA.candles.length);
  for (const c of DATA.candles.slice(0, 50)) {
    assert.ok(c.close > 0 && c.high >= c.low && c.ts > 0);
  }
});

test('ReplayFeed seeds, steps in recorded order, and wraps', async () => {
  const feed = new ReplayFeed(DATA);
  const seeded = await feed.seedHistory(60);
  assert.equal(seeded, 60);
  assert.equal(feed.history[0].price, DATA.candles[0].close);
  assert.equal(feed.history[0].source, 'replay');
  const pt = await feed.pollOnce();
  assert.equal(pt.price, DATA.candles[60].close);
  assert.equal(feed.latest().price, pt.price);
  assert.match(feed.label(), /REPLAY/);
  assert.match(feed.label(), /Kraken/);
});

test('ReplayFeed requires real candle data and steps multiple candles', async () => {
  assert.throws(() => new ReplayFeed({ candles: [] }), /recorded candle data/);
  assert.throws(() => new ReplayFeed(null), /recorded candle data/);
  const feed = new ReplayFeed(DATA, { stepCandles: 5 });
  await feed.seedHistory(10);
  const before = feed.history.length;
  await feed.pollOnce();
  assert.equal(feed.history.length, before + 5);
});
