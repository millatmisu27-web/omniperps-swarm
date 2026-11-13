'use strict';
/**
 * ReplayFeed — plays back RECORDED REAL prices (Kraken BTC/USD
 * 1-minute candles, captured into data/replay-btc.json) through the
 * exact same interface as the live PriceFeed ({history, lastSource,
 * lastError, seedHistory(), pollOnce(), latest()}).
 *
 * This is the offline half of the demo's dual LIVE ⇄ REPLAY design:
 *  - LIVE is the default whenever the network feeds answer.
 *  - REPLAY is selected manually (console toggle / `npm run demo -- --replay`)
 *    or automatically when every live source fails.
 * Replay prices are real recorded market data — never fabricated —
 * and every surface labels the mode "REPLAY" with the capture date.
 * No price is invented here either: if constructed without candle
 * data, pollOnce() throws.
 */

class ReplayFeed {
  /**
   * @param {{meta: object, candles: Array<{ts,open,high,low,close,volume}>}} data
   *        parsed contents of data/replay-btc.json (or a trimmed copy
   *        of the same shape, e.g. the window bundled into demo-dist).
   * @param {{stepCandles?: number}} [opts] candles advanced per poll (default 1).
   */
  constructor(data, { stepCandles = 1 } = {}) {
    if (!data || !Array.isArray(data.candles) || data.candles.length === 0) {
      throw new Error('ReplayFeed needs recorded candle data (data/replay-btc.json)');
    }
    this.meta = data.meta || {};
    this.candles = data.candles;
    this.stepCandles = Math.max(1, stepCandles | 0);
    this.cursor = 0;          // index of the next candle to play
    this.loops = 0;           // how many times playback wrapped around
    this.history = [];        // {ts, price, source} — same shape as PriceFeed
    this.lastSource = 'replay';
    this.lastError = null;
    this.mode = 'replay';
  }

  label() {
    const m = this.meta;
    return `REPLAY — recorded real prices (Kraken ${m.pair || 'BTC/USD'}, ${m.interval_minutes || 1}m candles, captured ${m.captured_at || 'unknown'})`;
  }

  /** Seed history with the first `limit` closes (replay "past"). */
  async seedHistory(limit = 60) {
    const n = Math.min(limit, this.candles.length);
    this.history = [];
    for (let i = 0; i < n; i++) {
      const c = this.candles[i];
      this.history.push({ ts: c.ts, price: c.close, source: 'replay' });
    }
    this.cursor = n;
    return n;
  }

  /** Advance playback by stepCandles candles; returns the newest point. */
  async pollOnce() {
    if (this.cursor >= this.candles.length) { this.cursor = 0; this.loops++; }
    let pt = null;
    for (let s = 0; s < this.stepCandles; s++) {
      if (this.cursor >= this.candles.length) { this.cursor = 0; this.loops++; }
      const c = this.candles[this.cursor++];
      pt = { ts: c.ts, price: c.close, source: 'replay' };
      this.history.push(pt);
    }
    if (this.history.length > 600) this.history.splice(0, this.history.length - 600);
    this.lastSource = 'replay';
    this.lastError = null;
    return pt;
  }

  latest() { return this.history.length ? this.history[this.history.length - 1] : null; }
}

module.exports = { ReplayFeed };
