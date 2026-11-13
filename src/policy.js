'use strict';
/**
 * SpendGuard — the swarm's policy engine (AI Security & Defense track).
 *
 * Every order the Execution Agent wants to place MUST pass checkOrder().
 * The Risk Agent calls it; a veto is final. Every check — pass or veto —
 * is written to an auditable log.
 *
 * This module is the off-chain reference implementation of the guard
 * state that the NEAR leg mirrors on testnet (see docs/NEAR_PROOF.md):
 * per-agent limits + a global kill switch.
 */

const DEFAULT_LIMITS = {
  // Per-order notional caps (USDT) by proposing/executing role
  maxNotionalPerOrder: 25000,
  // Hard leverage ceiling for any agent, regardless of proposal
  maxLeverage: 10,
  // An order is vetoed if its liquidation price would sit closer
  // than this % distance from the entry price (too fragile).
  minLiquidationDistancePct: 12,
  // Swarm is halted for the day if realised losses exceed this (USDT)
  maxDailyRealisedLoss: 5000,
};

class SpendGuard {
  constructor(limits = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.killSwitch = false;
    this.killedBy = null;
    this.log = []; // every check, in order
  }

  setKill(on, by = 'operator') {
    this.killSwitch = !!on;
    this.killedBy = on ? by : null;
    const ev = { ts: Date.now(), type: on ? 'kill_engaged' : 'kill_released', by };
    this.log.push({ ts: ev.ts, agent: by, verdict: ev.type, reasons: [] });
    return ev;
  }

  /**
   * @param order {agent, side, sizeBtc, leverage, price, liquidationPrice, dailyRealisedPnl}
   * @returns {allowed: boolean, reasons: string[]}
   */
  checkOrder(order) {
    const reasons = [];
    const notional = order.sizeBtc * order.price;

    if (this.killSwitch) reasons.push(`KILL SWITCH is engaged (by ${this.killedBy || 'operator'}) — all trading halted`);
    if (notional > this.limits.maxNotionalPerOrder) {
      reasons.push(`notional $${notional.toFixed(2)} exceeds per-order cap $${this.limits.maxNotionalPerOrder}`);
    }
    if (order.leverage > this.limits.maxLeverage) {
      reasons.push(`leverage ${order.leverage}x exceeds ceiling ${this.limits.maxLeverage}x`);
    }
    if (order.liquidationPrice != null && order.price > 0) {
      const distPct = Math.abs(order.price - order.liquidationPrice) / order.price * 100;
      if (distPct < this.limits.minLiquidationDistancePct) {
        reasons.push(`liquidation distance ${distPct.toFixed(2)}% below minimum ${this.limits.minLiquidationDistancePct}%`);
      }
    }
    if ((order.dailyRealisedPnl ?? 0) < -this.limits.maxDailyRealisedLoss) {
      reasons.push(`daily realised loss limit $${this.limits.maxDailyRealisedLoss} already breached`);
    }

    const allowed = reasons.length === 0;
    this.log.push({
      ts: Date.now(),
      agent: order.agent,
      verdict: allowed ? 'allow' : 'veto',
      notional: Math.round(notional * 100) / 100,
      reasons,
    });
    return { allowed, reasons };
  }

  snapshot() {
    return {
      limits: { ...this.limits },
      killSwitch: this.killSwitch,
      killedBy: this.killedBy,
      checksLogged: this.log.length,
      vetoes: this.log.filter(l => l.verdict === 'veto').length,
    };
  }
}

module.exports = { SpendGuard, DEFAULT_LIMITS };
