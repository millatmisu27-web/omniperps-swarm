'use strict';
/**
 * OmniPerps Swarm — SpendGuard contract proof (zero-dependency).
 *
 * Exercises the REAL deployed contract at `guard.omniperps-swarm.testnet`:
 *   1. reads live state (view — anyone can run this),
 *   2. in-limit order        -> allowed: true
 *   3. oversize order        -> allowed: false (per-order cap)
 *   4. kill switch ON (owner)-> same in-limit order denied; then OFF again.
 *
 * Steps 2–4 are signed calls and need the swarm master's demo key, read
 * from the coordinator-held keys file OUTSIDE this repo:
 *   KEYS_FILE=/path/to/omniperps-testnet-keys.txt node scripts/guard-proof.js
 * Without it, only the live state read is performed (still a real check).
 */
const fs = require('node:fs');
const { rpc, TESTNET_RPC } = require('../src/near-proof');
const { callFunctionSigned, functionCallResult } = require('../src/near-tx');

const GUARD = 'guard.omniperps-swarm.testnet';
const MASTER = 'omniperps-swarm.testnet';
const KEYS_FILE = process.env.KEYS_FILE || '/home/hatch/workspace/omniperps-testnet-keys.txt';

async function viewCall(accountId, methodName, args) {
  const result = await rpc(TESTNET_RPC, 'query', {
    request_type: 'call_function', finality: 'final',
    account_id: accountId, method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  if (result.error) throw new Error(`view ${methodName}: ${result.error}`);
  return JSON.parse(Buffer.from(result.result).toString('utf8'));
}

function loadMasterKeys() {
  const text = fs.readFileSync(KEYS_FILE, 'utf8');
  const idx = text.indexOf(MASTER);
  if (idx < 0) throw new Error(`${MASTER} not found in keys file`);
  const matches = [...text.slice(idx).matchAll(/ed25519:([1-9A-HJ-NP-Za-km-z]+)/g)].map((m) => m[0]);
  if (matches.length < 2) throw new Error('could not parse master keys');
  return { publicKey: matches[0], secretKey: matches[1] };
}

async function main() {
  console.log(`SpendGuard contract: ${GUARD} (NEAR testnet)`);
  const state0 = await viewCall(GUARD, 'get_state', {});
  console.log('LIVE get_state:', JSON.stringify(state0));

  if (!fs.existsSync(KEYS_FILE)) {
    console.log(`\nKeys file not found (${KEYS_FILE}) — view-only run. Set KEYS_FILE to the demo keys file to run the signed checks.`);
    return;
  }
  const keys = loadMasterKeys();
  const call = async (methodName, args) => {
    const { txHash, outcome } = await callFunctionSigned({
      signerId: MASTER, secretKeyString: keys.secretKey, publicKeyString: keys.publicKey,
      contractId: GUARD, methodName, args,
    });
    return { txHash, result: functionCallResult(outcome) };
  };

  const inLimit = { notional: 9000, leverage: 5, liq_distance_pct: 40, daily_loss: 0 };
  let failures = 0;
  const expect = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`); if (!cond) failures++; };

  const c1 = await call('check_order', inLimit);
  console.log(`check_order(in-limit $9,000 / 5x / 40% / $0) -> ${JSON.stringify(c1.result)}  [tx ${c1.txHash}]`);
  expect('in-limit order is allowed', c1.result && c1.result.allowed === true);

  const c2 = await call('check_order', { ...inLimit, notional: 40000 });
  console.log(`check_order(oversize $40,000) -> ${JSON.stringify(c2.result)}  [tx ${c2.txHash}]`);
  expect('oversize order is denied by the cap', c2.result && c2.result.allowed === false);

  const k1 = await call('set_killed', { on: true });
  console.log(`set_killed(true) by owner -> ${JSON.stringify(k1.result)}  [tx ${k1.txHash}]`);
  const c3 = await call('check_order', inLimit);
  console.log(`check_order(in-limit, kill switch ON) -> ${JSON.stringify(c3.result)}  [tx ${c3.txHash}]`);
  expect('kill switch denies even an in-limit order', c3.result && c3.result.allowed === false);

  const k2 = await call('set_killed', { on: false });
  console.log(`set_killed(false) by owner -> ${JSON.stringify(k2.result)}  [tx ${k2.txHash}]`);

  const state1 = await viewCall(GUARD, 'get_state', {});
  console.log('get_state after:', JSON.stringify(state1));
  expect('checks_count recorded all 3 checks', state1.checks_count === state0.checks_count + 3);
  expect('kill switch left OFF at the end', state1.killed === false);

  if (failures) { console.error(`\n*** ${failures} EXPECTATION(S) FAILED ***`); process.exit(1); }
  console.log('\n*** SPENDGUARD CONTRACT PROOF: ALL CHECKS PASSED against the live testnet contract ***');
}

main().catch((e) => { console.error(e); process.exit(1); });
