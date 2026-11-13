'use strict';
/**
 * PerpEngine — a single-market (BTC-PERP) perpetuals engine with
 * paper settlement and correct isolated-margin math.
 *
 * Prices fed in are REAL (live public feeds — see pricefeed.js).
 * Settlement is PAPER: no real funds move. That split is stated
 * plainly in the README and the UI.
 *
 * Conventions:
 *  - Collateral / PnL currency: USDT (paper).
 *  - One open position at a time (demo account), isolated margin.
 *  - Maintenance margin rate (mmr): 0.5% of mark notional.
 *  - Taker fee: 0.05% of notional, charged on open and on close.
 */

const MMR = 0.005;          // maintenance margin rate
const TAKER_FEE = 0.0005;   // 0.05%

class PerpEngine {
  constructor({ startingBalance = 100000 } = {}) {
    this.walletBalance = startingBalance; // realised, free collateral (USDT paper)
    this.position = null;                 // {side,sizeBtc,entryPrice,leverage,margin,openedAt}
    this.markPrice = null;
    this.realisedPnlTotal = 0;
    this.feesPaidTotal = 0;
    this.liquidations = 0;
    this.events = [];                     // engine-level event log
  }

  setMarkPrice(price) {
    if (!(price > 0)) throw new Error('mark price must be > 0');
    this.markPrice = price;
    return this.checkLiquidation();
  }

  notional(sizeBtc, price) { return sizeBtc * price; }

  /** Margin required to open: notional / leverage. */
  requiredMargin(sizeBtc, price, leverage) {
    return this.notional(sizeBtc, price) / leverage;
  }

  /**
   * Liquidation price (isolated margin).
   * Long : liq = entry * (1 - 1/L) / (1 - mmr)
   * Short: liq = entry * (1 + 1/L) / (1 + mmr)
   * Derived from: loss at liq == margin - mmr * liqNotional.
   */
  liquidationPrice(side, entryPrice, leverage) {
    if (side === 'long') return entryPrice * (1 - 1 / leverage) / (1 - MMR);
    return entryPrice * (1 + 1 / leverage) / (1 + MMR);
  }

  unrealisedPnl(price = this.markPrice) {
    if (!this.position || price == null) return 0;
    const { side, sizeBtc, entryPrice } = this.position;
    return side === 'long'
      ? (price - entryPrice) * sizeBtc
      : (entryPrice - price) * sizeBtc;
  }

  /** Account equity = free collateral + locked margin + uPnL. */
  equity(price = this.markPrice) {
    if (!this.position) return this.walletBalance;
    return this.walletBalance + this.position.margin + this.unrealisedPnl(price);
  }

  maintenanceMargin(price = this.markPrice) {
    if (!this.position || price == null) return 0;
    return this.notional(this.position.sizeBtc, price) * MMR;
  }

  /** Distance from mark price to liquidation price, as % of mark. */
  liquidationDistancePct(price = this.markPrice) {
    if (!this.position || price == null) return null;
    const liq = this.liquidationPrice(this.position.side, this.position.entryPrice, this.position.leverage);
    return Math.abs(price - liq) / price * 100;
  }

  openPosition({ side, sizeBtc, leverage, price }) {
    if (this.position) throw new Error('a position is already open');
    if (!['long', 'short'].includes(side)) throw new Error('side must be long|short');
    if (!(sizeBtc > 0)) throw new Error('sizeBtc must be > 0');
    if (!(leverage >= 1 && leverage <= 50)) throw new Error('leverage must be 1..50');
    const margin = this.requiredMargin(sizeBtc, price, leverage);
    const fee = this.notional(sizeBtc, price) * TAKER_FEE;
    if (margin + fee > this.walletBalance) throw new Error('insufficient collateral');
    this.walletBalance -= (margin + fee);
    this.feesPaidTotal += fee;
    this.position = { side, sizeBtc, entryPrice: price, leverage, margin, openedAt: Date.now() };
    this.markPrice = price;
    const liq = this.liquidationPrice(side, price, leverage);
    this.events.push({ ts: Date.now(), type: 'open', side, sizeBtc, price, leverage, margin, fee, liquidationPrice: liq });
    return { ...this.position, liquidationPrice: liq, fee };
  }

  /**
   * Close `fraction` (0..1) of the position at `price`.
   * Returns realised PnL for the closed part. Realised loss can never
   * exceed the margin allocated to the closed part (isolated margin);
   * liquidation (checkLiquidation) is what enforces that boundary live.
   */
  closePosition(price, fraction = 1) {
    if (!this.position) throw new Error('no open position');
    if (!(fraction > 0 && fraction <= 1)) throw new Error('fraction must be in (0,1]');
    const pos = this.position;
    const closeSize = pos.sizeBtc * fraction;
    const pnlPerBtc = pos.side === 'long' ? price - pos.entryPrice : pos.entryPrice - price;
    let pnl = pnlPerBtc * closeSize;
    const marginPart = pos.margin * fraction;
    if (pnl < -marginPart) pnl = -marginPart; // isolated-margin floor
    const fee = this.notional(closeSize, price) * TAKER_FEE;
    const returned = Math.max(0, marginPart + pnl - fee);
    this.walletBalance += returned;
    this.feesPaidTotal += fee;
    this.realisedPnlTotal += pnl;
    this.events.push({ ts: Date.now(), type: fraction >= 1 ? 'close' : 'reduce', side: pos.side, sizeBtc: closeSize, price, pnl, fee, returned });
    if (fraction >= 1) {
      this.position = null;
    } else {
      this.position = { ...pos, sizeBtc: pos.sizeBtc - closeSize, margin: pos.margin - marginPart };
    }
    return { pnl, fee, returned };
  }

  /**
   * Isolated-margin liquidation: if the POSITION's own equity
   * (its margin + its uPnL) falls to/below its maintenance margin,
   * the position is liquidated and its margin is lost. Free wallet
   * collateral does NOT rescue an isolated position.
   */
  checkLiquidation(price = this.markPrice) {
    if (!this.position || price == null) return null;
    const positionEquity = this.position.margin + this.unrealisedPnl(price);
    if (positionEquity <= this.maintenanceMargin(price)) {
      const pos = { ...this.position };
      const pnl = -pos.margin; // isolated: entire margin is lost
      this.realisedPnlTotal += pnl;
      this.position = null;
      this.liquidations += 1;
      const ev = { ts: Date.now(), type: 'liquidation', side: pos.side, sizeBtc: pos.sizeBtc, price, pnl };
      this.events.push(ev);
      return ev;
    }
    return null;
  }

  snapshot() {
    const liq = this.position
      ? this.liquidationPrice(this.position.side, this.position.entryPrice, this.position.leverage)
      : null;
    return {
      walletBalance: round2(this.walletBalance),
      markPrice: this.markPrice,
      position: this.position ? { ...this.position, liquidationPrice: round2(liq) } : null,
      unrealisedPnl: round2(this.unrealisedPnl()),
      equity: round2(this.equity()),
      maintenanceMargin: round2(this.maintenanceMargin()),
      liquidationDistancePct: this.position ? round2(this.liquidationDistancePct()) : null,
      realisedPnlTotal: round2(this.realisedPnlTotal),
      feesPaidTotal: round2(this.feesPaidTotal),
      liquidations: this.liquidations,
    };
  }
}

function round2(n) { return Math.round(n * 100) / 100; }

module.exports = { PerpEngine, MMR, TAKER_FEE };
