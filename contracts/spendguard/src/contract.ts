import { NearBindgen, near, call, view, initialize } from 'near-sdk-js';

/**
 * SpendGuard — the on-chain (NEAR testnet) mirror of the swarm's policy
 * engine in `src/policy.js`. Field names/defaults mirror DEFAULT_LIMITS:
 *   maxNotionalPerOrder      -> max_notional_per_order      (25000 USD)
 *   maxLeverage              -> max_leverage                (10)
 *   minLiquidationDistancePct-> min_liquidation_distance_pct(12)
 *   maxDailyRealisedLoss     -> max_daily_realised_loss     (5000 USD)
 *   killSwitch               -> killed
 *
 * Deployed on testnet as `guard.omniperps-swarm.testnet`; owner is the
 * swarm master `omniperps-swarm.testnet` (only the owner can toggle the
 * kill switch).
 */
@NearBindgen({})
export class SpendGuard {
  owner: string = '';
  max_notional_per_order: number = 25000;
  max_leverage: number = 10;
  min_liquidation_distance_pct: number = 12;
  max_daily_realised_loss: number = 5000;
  killed: boolean = false;
  checks_count: number = 0;

  @initialize({})
  init({
    owner,
    max_notional_per_order,
    max_leverage,
    min_liquidation_distance_pct,
    max_daily_realised_loss,
  }: {
    owner: string;
    max_notional_per_order?: number;
    max_leverage?: number;
    min_liquidation_distance_pct?: number;
    max_daily_realised_loss?: number;
  }) {
    this.owner = owner;
    if (max_notional_per_order !== undefined) this.max_notional_per_order = max_notional_per_order;
    if (max_leverage !== undefined) this.max_leverage = max_leverage;
    if (min_liquidation_distance_pct !== undefined) this.min_liquidation_distance_pct = min_liquidation_distance_pct;
    if (max_daily_realised_loss !== undefined) this.max_daily_realised_loss = max_daily_realised_loss;
  }

  @view({})
  get_state() {
    return {
      owner: this.owner,
      max_notional_per_order: this.max_notional_per_order,
      max_leverage: this.max_leverage,
      min_liquidation_distance_pct: this.min_liquidation_distance_pct,
      max_daily_realised_loss: this.max_daily_realised_loss,
      killed: this.killed,
      checks_count: this.checks_count,
    };
  }

  /**
   * Mirrors SpendGuard.checkOrder() in src/policy.js.
   * - notional: order notional in USD (policy computes sizeBtc * price)
   * - leverage: order leverage
   * - liq_distance_pct: |price - liquidationPrice| / price * 100
   * - daily_loss: the swarm's current daily realised PnL in USD
   *   (negative = losing), i.e. policy.js's `dailyRealisedPnl`; the order
   *   is vetoed once daily_loss < -max_daily_realised_loss.
   * Records the check (checks_count) and returns the verdict.
   */
  @call({})
  check_order({
    notional,
    leverage,
    liq_distance_pct,
    daily_loss,
  }: {
    notional: number;
    leverage: number;
    liq_distance_pct: number;
    daily_loss: number;
  }) {
    this.checks_count += 1;
    const reasons: string[] = [];
    if (this.killed) {
      reasons.push('KILL SWITCH is engaged - all trading halted');
    }
    if (notional > this.max_notional_per_order) {
      reasons.push(`notional ${notional} exceeds per-order cap ${this.max_notional_per_order}`);
    }
    if (leverage > this.max_leverage) {
      reasons.push(`leverage ${leverage}x exceeds ceiling ${this.max_leverage}x`);
    }
    if (liq_distance_pct < this.min_liquidation_distance_pct) {
      reasons.push(`liquidation distance ${liq_distance_pct}% below minimum ${this.min_liquidation_distance_pct}%`);
    }
    if (daily_loss < -this.max_daily_realised_loss) {
      reasons.push(`daily realised loss limit ${this.max_daily_realised_loss} already breached`);
    }
    return { allowed: reasons.length === 0, reason: reasons.length ? reasons.join('; ') : 'ok' };
  }

  /** Owner-only kill switch (mirrors policy.js setKill). */
  @call({})
  set_killed({ on }: { on: boolean }) {
    if (near.predecessorAccountId() !== this.owner) {
      throw new Error('set_killed: only the owner can toggle the kill switch');
    }
    this.killed = on;
    near.log(`SpendGuard kill switch ${on ? 'ENGAGED' : 'RELEASED'} by ${near.predecessorAccountId()}`);
    return { killed: this.killed };
  }
}
