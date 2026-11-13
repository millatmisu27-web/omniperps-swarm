'use strict';
/**
 * OmniPerps Swarm — SpendGuard contract deployment (TOOLING ONLY).
 *
 * Creates the sub-account `guard.omniperps-swarm.testnet` from the swarm
 * master, deploys contracts/spendguard/build/spendguard.wasm (near-sdk-js),
 * and calls init(owner = master). The guard account's fresh keypair is
 * appended to the coordinator-held keys file OUTSIDE the repo BEFORE the
 * account is created, so the key can never be lost mid-deploy. Nothing
 * secret is printed or written anywhere in the repo.
 *
 * Usage: node deploy-guard.js
 */
const fs = require('node:fs');
const path = require('node:path');
const { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions, parseNearAmount } = require('near-api-js');

const KEYS_FILE = process.env.KEYS_FILE || '/home/hatch/workspace/omniperps-testnet-keys.txt';
const MASTER = 'omniperps-swarm.testnet';
const MASTER_PUBLIC_KEY = 'ed25519:FwGz4NS2y4qDvVA3aQzF1zLSbriVBctQfbKjEv3wQkL2';
const GUARD = 'guard.omniperps-swarm.testnet';
const RPC_URL = 'https://rpc.testnet.near.org';
const WASM_PATH = path.join(__dirname, '..', '..', 'contracts', 'spendguard', 'build', 'spendguard.wasm');
const FUND_NEAR = '7';
const EVIDENCE_FILE = process.env.EVIDENCE_FILE || '/tmp/guard-evidence.json';

function loadKeyPair(accountId, expectedPublic) {
  const text = fs.readFileSync(KEYS_FILE, 'utf8');
  const idx = text.indexOf(accountId);
  if (idx < 0) throw new Error(`${accountId} not found in keys file`);
  const matches = [...text.slice(idx).matchAll(/ed25519:([1-9A-HJ-NP-Za-km-z]+)/g)].map((m) => m[0]);
  if (matches.length < 2) throw new Error(`could not parse keys for ${accountId}`);
  const keyPair = KeyPair.fromString(matches[1]);
  if (keyPair.getPublicKey().toString() !== matches[0]) throw new Error(`key mismatch for ${accountId}`);
  if (expectedPublic && matches[0] !== expectedPublic) throw new Error(`public key drift for ${accountId}`);
  return keyPair;
}

async function viewCall(accountId, methodName, args) {
  const res = await fetch(RPC_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'view', method: 'query',
      params: { request_type: 'call_function', finality: 'final', account_id: accountId, method_name: methodName, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') },
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 300));
  if (body.result.error) throw new Error(body.result.error);
  return JSON.parse(Buffer.from(body.result.result).toString('utf8'));
}

function outcomeError(outcome) {
  const st = outcome && outcome.status;
  return st && st.Failure ? JSON.stringify(st.Failure).slice(0, 500) : null;
}

async function main() {
  const provider = new JsonRpcProvider({ url: RPC_URL });
  const masterKey = loadKeyPair(MASTER, MASTER_PUBLIC_KEY);
  const master = new Account(MASTER, provider, KeyPairSigner.fromSecretKey(masterKey.toString()));

  const wasm = fs.readFileSync(WASM_PATH);
  console.log(`wasm: ${wasm.length} bytes from ${WASM_PATH}`);

  // 1. Fresh guard keypair -> append to the outside-repo keys file FIRST.
  let guardKey;
  try {
    guardKey = loadKeyPair(GUARD, null);
    console.log('guard key already present in keys file — reusing');
  } catch {
    guardKey = KeyPair.fromRandom('ed25519');
    const block = `\n${GUARD}\n  public:  ${guardKey.getPublicKey().toString()}\n  secret:  ${guardKey.toString()}\n`;
    fs.appendFileSync(KEYS_FILE, block);
    console.log('guard keypair generated and appended to keys file (outside repo)');
  }

  // 2. Create the sub-account from master (skip if it already exists).
  let createTxHash = null;
  try {
    await provider.viewAccount({ accountId: GUARD });
    console.log('guard account already exists — skipping creation');
  } catch {
    const outcome = await master.createSubAccount({
      accountOrPrefix: 'guard',
      publicKey: guardKey.getPublicKey(),
      nearToTransfer: BigInt(parseNearAmount(FUND_NEAR)),
    });
    const err = outcomeError(outcome);
    if (err) throw new Error(`createSubAccount failed: ${err}`);
    createTxHash = outcome.transaction.hash;
    console.log(`sub-account created: ${GUARD} funded with ${FUND_NEAR} NEAR, tx ${createTxHash}`);
  }

  // 3. Deploy the contract code.
  const guardAccount = new Account(GUARD, provider, KeyPairSigner.fromSecretKey(guardKey.toString()));
  const acctState = await provider.viewAccount({ accountId: GUARD });
  console.log(`guard balance: ${acctState.amount} yocto, code_hash before: ${acctState.code_hash}`);
  let deployTxHash = null;
  if (acctState.code_hash === '11111111111111111111111111111111') {
    const outcome = await guardAccount.deployContract(wasm);
    const err = outcomeError(outcome);
    if (err) throw new Error(`deployContract failed: ${err}`);
    deployTxHash = outcome.transaction.hash;
    console.log(`contract deployed, tx ${deployTxHash}`);
  } else {
    console.log('contract code already present — skipping deploy');
  }

  // 4. init(owner = master) — near-sdk-js serves DEFAULT state via views
  // before init runs (owner ''), so "get_state answers" is NOT proof of
  // init: only skip when the stored owner is already the master.
  let initTxHash = null;
  let state = null;
  try { state = await viewCall(GUARD, 'get_state', {}); } catch { /* not initialised */ }
  if (!state || state.owner !== MASTER) {
    const action = actions.functionCall(
      'init',
      new TextEncoder().encode(JSON.stringify({ owner: MASTER })),
      30_000_000_000_000n,
      0n,
    );
    const signedTx = await master.createSignedTransaction({ receiverId: GUARD, actions: [action] });
    const outcome = await provider.sendTransactionUntil(signedTx, 'FINAL');
    const err = outcomeError(outcome);
    if (err) throw new Error(`init failed: ${err}`);
    initTxHash = outcome.transaction.hash;
    console.log(`init(owner=${MASTER}) done, tx ${initTxHash}`);
    state = await viewCall(GUARD, 'get_state', {});
  }
  console.log('get_state:', JSON.stringify(state));

  const after = await provider.viewAccount({ accountId: GUARD });
  const evidence = {
    kind: 'spendguard-deploy-evidence',
    network: 'testnet',
    contract_account: GUARD,
    owner: MASTER,
    wasm_bytes: wasm.length,
    funded_near: FUND_NEAR,
    create_tx_hash: createTxHash,
    deploy_tx_hash: deployTxHash,
    init_tx_hash: initTxHash,
    code_hash_after: after.code_hash,
    balance_after_yocto: String(after.amount),
    state,
    fetched_at: new Date().toISOString(),
  };
  fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(evidence, null, 2));
  console.log(`evidence saved to ${EVIDENCE_FILE}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
