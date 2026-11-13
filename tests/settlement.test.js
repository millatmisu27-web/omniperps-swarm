'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planSettlement, totalTransferYocto, NEAR_PER_LEDGER_UNIT, AGENT_ACCOUNTS, MAX_TOTAL_NEAR } = require('../src/settlement');

test('settlement plan converts ledger units at the stated rate, exactly', () => {
  const plan = planSettlement({ signal: 2, risk: 21.5, execution: 13 });
  const byAgent = Object.fromEntries(plan.map(p => [p.agent, p]));
  assert.equal(byAgent.signal.amountNear, '0.0200');
  assert.equal(byAgent.risk.amountNear, '0.2150');
  assert.equal(byAgent.execution.amountNear, '0.1300');
  // exact yocto math: 0.215 NEAR = 215 * 10^21 yocto
  assert.equal(byAgent.risk.amountYocto, 215n * 10n ** 21n);
  assert.equal(NEAR_PER_LEDGER_UNIT, 0.01);
});

test('execution settles to the master (payer) and is excluded from transfers', () => {
  const plan = planSettlement({ signal: 2, risk: 21.5, execution: 13 });
  const exec = plan.find(p => p.agent === 'execution');
  assert.equal(exec.selfTransfer, true);
  assert.equal(exec.toAccount, 'omniperps-swarm.testnet');
  assert.equal(plan.find(p => p.agent === 'signal').toAccount, AGENT_ACCOUNTS.signal);
  assert.equal(plan.find(p => p.agent === 'risk').toAccount, AGENT_ACCOUNTS.risk);
  // only signal + risk leave the payer: 0.235 NEAR
  assert.equal(totalTransferYocto(plan), 235n * 10n ** 21n);
});

test('zero balances produce no payments; plan stays under the spend cap for a demo session', () => {
  assert.deepEqual(planSettlement({ signal: 0, risk: 0, execution: 0 }), []);
  const plan = planSettlement({ signal: 2, risk: 21.5, execution: 13 });
  assert.ok(Number(totalTransferYocto(plan)) / 1e24 <= MAX_TOTAL_NEAR);
});
