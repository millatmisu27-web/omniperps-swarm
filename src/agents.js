'use strict';
/**
 * The Swarm — three agents, one auditable conversation.
 *
 *  Signal Agent    watches the live price, proposes trades with reasons.
 *  Risk Agent      independent. Reviews every proposal against the
 *                  SpendGuard policy + live liquidation distance.
 *                  Can APPROVE, VETO (final), REDUCE, and can
 *                  FORCE-REDUCE / FORCE-CLOSE an open position.
 *  Execution Agent the only agent that can touch the PerpEngine, and
 *                  only with a Risk approval in hand. Re-checks the
 *                  SpendGuard itself immediately before acting.
 *
 * Agent Economy: agents are paid per completed task from a protocol
 * fee pool into an internal ledger (see FeeLedger) — Signal earns for
 * an executed proposal, Risk earns per review and a bonus for a
 * protective force-reduce, Execution earns per order. The ledger is
 * shown in the UI and mirrors the per-agent NEAR sub-account design
 * in docs/NEAR_PROOF.md.
 */

const FEES = {
  signalExecutedProposal: 2.0,
  riskReview: 1.5,
  riskProtectionBonus: 4.0,
  executionOrder: 3.0,
  executionClose: 2.0,
};

class FeeLedger {
  constructor() { this.entries = []; this.balances = { signal: 0, risk: 0, execution: 0 }; }
  pay(to, amount, reason) {
    this.balances[to] = Math.round((this.balances[to] + amount) * 100) / 100;
    this.entries.push({ ts: Date.now(), from: 'protocol-fee-pool', to, amount, reason });
  }
}

function ema(values, period) {
  const k = 2 / (period + 1);
  let e = values[0];
  for (const v of values) e = v * k + e * (1 - k);
  return e;
}

class SignalAgent {
  constructor() { this.name = 'signal'; }
  /** Propose a trade from price history (EMA crossover + momentum). */
  evaluate(history, markPrice) {
    if (history.length < 25) return null;
    const closes = history.map(h => h.price);
    const fast = ema(closes.slice(-30), 5);
    const slow = ema(closes.slice(-60), 20);
    const momentumPct = (fast - slow) / slow * 100;
    const side = momentumPct >= 0 ? 'long' : 'short';
    // Target ~$18k notional (inside the $25k guard cap), 5x leverage.
    const sizeBtc = Math.round((18000 / markPrice) * 10000) / 10000;
    return {
      side, sizeBtc, leverage: 5,
      reason: `EMA5 ${momentumPct >= 0 ? 'above' : 'below'} EMA20 by ${Math.abs(momentumPct).toFixed(3)}% on live BTC feed — momentum favours ${side.toUpperCase()}`,
      confidence: Math.min(0.99, 0.5 + Math.abs(momentumPct) * 2),
      momentumPct,
    };
  }
}

class RiskAgent {
  constructor() { this.name = 'risk'; this.protectDistancePct = 12; this.criticalDistancePct = 7; }

  review(proposal, engine, guard) {
    const liq = engine.liquidationPrice(proposal.side, engine.markPrice ?? proposal.price, proposal.leverage);
    const price = engine.markPrice ?? proposal.price;
    const distPct = Math.abs(price - liq) / price * 100;
    let sizeBtc = proposal.sizeBtc;
    let adjusted = false;
    // Fragile proposals get cut in half before the guard check.
    if (distPct < 20 && sizeBtc > 0.02) { sizeBtc = Math.round(sizeBtc / 2 * 10000) / 10000; adjusted = true; }
    const check = guard.checkOrder({
      agent: 'execution', side: proposal.side, sizeBtc, leverage: proposal.leverage,
      price, liquidationPrice: liq, dailyRealisedPnl: engine.realisedPnlTotal,
    });
    if (!check.allowed) {
      return { verdict: 'veto', sizeBtc, liquidationPrice: liq, distancePct: distPct, reasons: check.reasons };
    }
    return {
      verdict: adjusted ? 'approve_reduced' : 'approve',
      sizeBtc, liquidationPrice: liq, distancePct: distPct,
      reasons: adjusted ? [`liquidation distance ${distPct.toFixed(1)}% is thin — size halved as a precaution`] : ['within all guard limits'],
    };
  }

  /** Protection check for an open position. Returns action or null. */
  protection(engine) {
    if (!engine.position) return null;
    const dist = engine.liquidationDistancePct();
    if (dist == null) return null;
    if (dist < this.criticalDistancePct) return { action: 'force_close', distancePct: dist, reason: `liquidation distance ${dist.toFixed(1)}% < critical ${this.criticalDistancePct}% — closing to save remaining margin` };
    if (dist < this.protectDistancePct) return { action: 'force_reduce', fraction: 0.5, distancePct: dist, reason: `liquidation distance ${dist.toFixed(1)}% < protection ${this.protectDistancePct}% — cutting position in half` };
    return null;
  }
}

class ExecutionAgent {
  constructor() { this.name = 'execution'; }
  open(engine, { side, sizeBtc, leverage, price }) { return engine.openPosition({ side, sizeBtc, leverage, price }); }
  close(engine, price, fraction = 1) { return engine.closePosition(price, fraction); }
}

/** NEAR Intents-style settlement intent for a trade (produced per order; see README for what is live vs produced). */
function buildSettlementIntent({ side, sizeBtc, price, accountId = 'omniperps-swarm.testnet' }) {
  return {
    intent_type: 'token_diff',
    produced_by: 'omniperps-swarm',
    account_id: accountId,
    market: 'BTC-PERP',
    side,
    diff: { 'perp:btc-usdt': side === 'long' ? `+${sizeBtc}` : `-${sizeBtc}`, 'usdt:collateral': 'paper-settlement' },
    reference_price_usd: price,
    note: 'Intent object produced by the swarm per executed order. Settlement itself is paper (see README).',
    ts: new Date().toISOString(),
  };
}

class Swarm {
  constructor({ engine, guard }) {
    this.engine = engine;
    this.guard = guard;
    this.signal = new SignalAgent();
    this.risk = new RiskAgent();
    this.execution = new ExecutionAgent();
    this.ledger = new FeeLedger();
    this.log = [];       // swarm decision transcript
    this.intents = [];   // settlement intents produced
    this.autoTrade = true;
    this.lastCycleAt = 0;
    this.cycleCooldownMs = 15000;
    this.protectionCooldownMs = 8000;
    this.protectionCooldownUntil = 0;
  }

  say(from, to, type, text) {
    const entry = { ts: Date.now(), from, to, type, text };
    this.log.push(entry);
    if (this.log.length > 400) this.log.shift();
    return entry;
  }

  setKill(on, by) {
    const ev = this.guard.setKill(on, by);
    this.say(by, 'swarm', on ? 'kill' : 'resume', on ? 'KILL SWITCH ENGAGED — all agents halted' : 'Kill switch released — agents may trade again');
    return ev;
  }

  /** One full decision cycle: propose -> review -> (execute | veto). */
  runCycle(history, markPrice) {
    if (this.guard.killSwitch) { this.say('risk', 'swarm', 'blocked', 'Cycle skipped: kill switch engaged'); return { acted: false, why: 'killed' }; }
    if (this.engine.position) return { acted: false, why: 'position-open' };
    const proposal = this.signal.evaluate(history, markPrice);
    if (!proposal) return { acted: false, why: 'not-enough-history' };
    this.say('signal', 'risk', 'propose', `${proposal.side.toUpperCase()} ${proposal.sizeBtc} BTC @ ~$${markPrice} x${proposal.leverage} — ${proposal.reason}`);
    const review = this.risk.review(proposal, this.engine, this.guard);
    this.ledger.pay('risk', FEES.riskReview, 'proposal review');
    if (review.verdict === 'veto') {
      this.say('risk', 'signal', 'veto', `VETO — ${review.reasons.join('; ')}`);
      return { acted: false, why: 'veto', review };
    }
    this.say('risk', 'execution', review.verdict, `${review.verdict === 'approve_reduced' ? 'APPROVED (reduced)' : 'APPROVED'} — size ${review.sizeBtc} BTC, liq @ $${review.liquidationPrice.toFixed(2)} (${review.distancePct.toFixed(1)}% away). ${review.reasons.join('; ')}`);
    // Execution re-checks the guard itself, immediately before acting.
    const recheck = this.guard.checkOrder({ agent: 'execution', side: proposal.side, sizeBtc: review.sizeBtc, leverage: proposal.leverage, price: markPrice, liquidationPrice: review.liquidationPrice, dailyRealisedPnl: this.engine.realisedPnlTotal });
    if (!recheck.allowed) {
      this.say('execution', 'swarm', 'blocked', `Execution refused at final guard check — ${recheck.reasons.join('; ')}`);
      return { acted: false, why: 'execution-guard-block', review };
    }
    const opened = this.execution.open(this.engine, { side: proposal.side, sizeBtc: review.sizeBtc, leverage: proposal.leverage, price: markPrice });
    this.ledger.pay('signal', FEES.signalExecutedProposal, 'executed proposal');
    this.ledger.pay('execution', FEES.executionOrder, 'order execution');
    const intent = buildSettlementIntent({ side: proposal.side, sizeBtc: review.sizeBtc, price: markPrice });
    this.intents.push(intent);
    this.say('execution', 'swarm', 'executed', `OPENED ${proposal.side.toUpperCase()} ${review.sizeBtc} BTC @ $${markPrice} — margin $${opened.margin.toFixed(2)}, liq @ $${opened.liquidationPrice.toFixed(2)}. Settlement intent produced.`);
    this.lastCycleAt = Date.now();
    return { acted: true, opened, review };
  }

  /** Per-tick housekeeping: liquidation events + risk protection. */
  onPrice(price) {
    const liqEv = this.engine.checkLiquidation(price);
    if (liqEv) {
      this.say('risk', 'swarm', 'liquidation', `POSITION LIQUIDATED @ $${price} — isolated margin lost. Protection acts earlier by design; this is the last-resort boundary.`);
      return liqEv;
    }
    if (this.engine.position && !this.guard.killSwitch && Date.now() >= this.protectionCooldownUntil) {
      const act = this.risk.protection(this.engine);
      if (act) {
        if (act.action === 'force_reduce') {
          const r = this.execution.close(this.engine, price, act.fraction);
          this.ledger.pay('risk', FEES.riskProtectionBonus, 'protective force-reduce');
          this.ledger.pay('execution', FEES.executionClose, 'force-reduce execution');
          this.say('risk', 'execution', 'force_reduce', `FORCE-REDUCE 50% @ $${price} — ${act.reason}. Realised PnL on closed half: $${r.pnl.toFixed(2)}`);
          this.protectionCooldownUntil = Date.now() + this.protectionCooldownMs;
        } else if (act.action === 'force_close') {
          const r = this.execution.close(this.engine, price, 1);
          this.ledger.pay('risk', FEES.riskProtectionBonus, 'protective force-close');
          this.ledger.pay('execution', FEES.executionClose, 'force-close execution');
          this.say('risk', 'execution', 'force_close', `FORCE-CLOSE @ $${price} — ${act.reason}. Realised PnL: $${r.pnl.toFixed(2)}`);
          this.protectionCooldownUntil = Date.now() + this.protectionCooldownMs;
        }
        return act;
      }
    }
    return null;
  }

  closePosition(price, by = 'operator') {
    if (!this.engine.position) return null;
    const r = this.execution.close(this.engine, price, 1);
    this.ledger.pay('execution', FEES.executionClose, `position close (${by})`);
    this.say('execution', 'swarm', 'executed', `CLOSED position @ $${price} by ${by} — realised PnL $${r.pnl.toFixed(2)}, fees $${r.fee.toFixed(2)}`);
    return r;
  }

  agentCards() {
    const halted = this.guard.killSwitch;
    return [
      // Real NEAR testnet accounts created for this project (see docs/NEAR_PROOF.md):
      // Signal and Risk hold their own agent accounts; Execution acts under the master.
      { id: 'signal', role: 'Signal Agent', status: halted ? 'halted' : 'watching live feed', earned: this.ledger.balances.signal, nearAccount: 'omniperps-agent1-7f3a.testnet' },
      { id: 'risk', role: 'Risk Agent', status: halted ? 'halted' : (this.engine.position ? 'guarding open position' : 'reviewing proposals'), earned: this.ledger.balances.risk, nearAccount: 'omniperps-agent2-7f3a.testnet' },
      { id: 'execution', role: 'Execution Agent', status: halted ? 'halted' : 'ready — guard-checked orders only', earned: this.ledger.balances.execution, nearAccount: 'omniperps-swarm.testnet (master)' },
    ];
  }

  snapshot() {
    return {
      agents: this.agentCards(),
      log: this.log.slice(-60),
      ledger: this.ledger.entries.slice(-30),
      ledgerBalances: this.ledger.balances,
      intents: this.intents.slice(-5),
      autoTrade: this.autoTrade,
    };
  }
}

module.exports = { Swarm, SignalAgent, RiskAgent, ExecutionAgent, FeeLedger, FEES, buildSettlementIntent };
