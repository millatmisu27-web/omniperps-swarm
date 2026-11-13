'use strict';
/**
 * PriceFeed — LIVE BTC/USD prices from public sources, in order:
 *   1. Kraken public Ticker API   (verified reachable from build env)
 *   2. Coinbase public Spot API   (verified reachable)
 *   3. CoinGecko simple price API (verified reachable)
 * Binance/Bybit were tried first in the build environment and are
 * geo-blocked there; they are not used.
 *
 * History is seeded from Kraken OHLC 1-minute candles and extended
 * with live polls. Every point records its source — the UI shows it.
 * No price is ever fabricated: if all sources fail, getPrice() throws
 * and the last source label says so.
 */

const SOURCES = [
  {
    name: 'kraken',
    url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
    parse: j => parseFloat(j.result.XXBTZUSD.c[0]),
  },
  {
    name: 'coinbase',
    url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
    parse: j => parseFloat(j.data.amount),
  },
  {
    name: 'coingecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    parse: j => j.bitcoin.usd,
  },
];

async function fetchJson(url, timeoutMs = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'omniperps-swarm/0.1' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

class PriceFeed {
  constructor() {
    this.history = [];       // {ts, price, source}
    this.lastSource = null;
    this.lastError = null;
  }

  async pollOnce() {
    let lastErr = null;
    for (const s of SOURCES) {
      try {
        const j = await fetchJson(s.url);
        const price = s.parse(j);
        if (!(price > 0)) throw new Error('bad price payload');
        const pt = { ts: Date.now(), price, source: s.name };
        this.history.push(pt);
        if (this.history.length > 600) this.history.shift();
        this.lastSource = s.name;
        this.lastError = null;
        return pt;
      } catch (e) { lastErr = e; }
    }
    this.lastError = String(lastErr && lastErr.message || lastErr);
    throw new Error(`all price sources failed: ${this.lastError}`);
  }

  /** Seed history from Kraken 1m OHLC candles (real market history). */
  async seedHistory(limit = 60) {
    try {
      const j = await fetchJson(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1`);
      const candles = j.result.XXBTZUSD.slice(-limit);
      for (const c of candles) {
        this.history.push({ ts: c[0] * 1000, price: parseFloat(c[4]), source: 'kraken-ohlc' });
      }
      return candles.length;
    } catch (e) {
      this.lastError = `seed failed: ${e.message}`;
      return 0;
    }
  }

  latest() { return this.history.length ? this.history[this.history.length - 1] : null; }
}

module.exports = { PriceFeed, SOURCES };
