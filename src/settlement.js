'use strict';
/**
 * Fee settlement planning — converts FeeLedger balances (abstract
 * ledger units, displayed as "$" in the console) into REAL NEAR
 * testnet transfer amounts at a fixed, stated conversion:
 *
 *     1 ledger unit  =  0.01 testnet NEAR
 *
 * Testnet NEAR has zero real-world value; the conversion exists so
 * the swarm's internal labour market settles on-chain with real,
 * explorable transactions (see scripts/settle-fees.js and
 * docs/NEAR_PROOF.md). Amounts are rounded to 0.0001 NEAR (the
 * yocto math below is exact integer arithmetic).
 *
 * Account mapping mirrors Swarm.agentCards(): Signal and Risk hold
 * their own agent accounts; Execution acts under the master, which
 * is also the payer — so Execution's share is retained by the payer
 * and NO self-transfer is planned for it.
 */

const NEAR_PER_LEDGER_UNIT = 0.01;
const MASTER = 'omniperps-swarm.testnet';
const AGENT_ACCOUNTS = {
  signal: 'omniperps-agent1-7f3a.testnet',
  risk: 'omniperps-agent2-7f3a.testnet',
  execution: MASTER, // acts under the master account
};
const MAX_TOTAL_NEAR = 1.0; // hard spend cap for one settlement run

/** One plan entry per agent with a positive balance. */
function planSettlement(balances) {
  const plan = [];
  for (const [agent, account] of Object.entries(AGENT_ACCOUNTS)) {
    const ledgerUnits = Math.round((balances[agent] || 0) * 100) / 100;
    if (!(ledgerUnits > 0)) continue;
    // 0.0001-NEAR units: ledger * NEAR_PER_LEDGER_UNIT * 10^4, exact in integers after rounding
    const microUnits = Math.round(ledgerUnits * NEAR_PER_LEDGER_UNIT * 10000);
    const amountYocto = BigInt(microUnits) * (10n ** 20n);
    const amountNear = (microUnits / 10000).toFixed(4);
    plan.push({
      agent,
      toAccount: account,
      ledgerUnits,
      amountNear,
      amountYocto,
      selfTransfer: account === MASTER,
    });
  }
  return plan;
}

/** Total yocto that would actually leave the payer (excludes the retained self-share). */
function totalTransferYocto(plan) {
  return plan.filter(p => !p.selfTransfer).reduce((acc, p) => acc + p.amountYocto, 0n);
}

module.exports = { NEAR_PER_LEDGER_UNIT, AGENT_ACCOUNTS, MASTER, MAX_TOTAL_NEAR, planSettlement, totalTransferYocto };
