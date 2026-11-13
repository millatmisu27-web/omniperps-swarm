'use strict';
/**
 * OmniPerps Swarm — REAL MPC signature request (TOOLING ONLY).
 *
 * This script is NOT part of the shipped zero-dependency runtime. It uses
 * near-api-js (installed in this tools/ folder) to submit a genuine `sign`
 * call to the NEAR testnet Chain Signatures contract
 * (`v1.signer-prod.testnet`) from the swarm master account, waits for the
 * MPC network to resume the yielded call with a signature, and saves the
 * raw evidence (tx hash + signature response) as JSON.
 *
 * The demo master key is read from the coordinator-held keys file OUTSIDE
 * the repo (never committed, never printed). Only testnet NEAR is spent.
 *
 * Usage:
 *   node mpc-sign.js                # submit + wait + save /tmp/mpc-evidence.json
 *   SIGN_ARGS=v2 node mpc-sign.js   # alternate args shape if the contract
 *                                   # rejects the default (see ARGS_STYLES)
 *   SIGN_DEPOSIT_NEAR=0.5 node mpc-sign.js
 *   node mpc-sign.js poll <txHash>  # only poll an already-submitted tx
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions, parseNearAmount } = require('near-api-js');

const KEYS_FILE = process.env.KEYS_FILE || '/home/hatch/workspace/omniperps-testnet-keys.txt';
const MASTER = 'omniperps-swarm.testnet';
const MASTER_PUBLIC_KEY = 'ed25519:FwGz4NS2y4qDvVA3aQzF1zLSbriVBctQfbKjEv3wQkL2'; // per docs/NEAR_PROOF.md
const MPC_CONTRACT = 'v1.signer-prod.testnet';
const PATH = 'ethereum-1';
const RPC_URL = 'https://rpc.testnet.near.org';
const EVIDENCE_FILE = process.env.EVIDENCE_FILE || '/tmp/mpc-evidence.json';

// Clearly-labelled demo payload: the MPC signs the sha256 of this message.
const MESSAGE = 'OmniPerps Swarm - NEAR HACKATHON demo payload: MPC signature proof over a BTC-PERP settlement intent (paper trade, no real funds). Master: omniperps-swarm.testnet, path: ethereum-1.';
const PAYLOAD = crypto.createHash('sha256').update(MESSAGE, 'utf8').digest();
const PAYLOAD_ARRAY = Array.from(PAYLOAD);

const ARGS_STYLES = {
  // chain-signatures contract API as in near/mpc chain-signatures/README:
  // sign({ payload: [u8; 32], path, key_version }) -> SignatureResponse
  flat: () => ({ payload: PAYLOAD_ARRAY, path: PATH, key_version: 0 }),
  // newer SignRequest wrapper with a typed payload enum
  v2: () => ({ request: { payload_v2: { Ecdsa: PAYLOAD_ARRAY }, path: PATH, key_version: 0 } }),
  'req-payload': () => ({ request: { payload: PAYLOAD_ARRAY, path: PATH, key_version: 0 } }),
};

function loadMasterKeyPair() {
  const text = fs.readFileSync(KEYS_FILE, 'utf8');
  const idx = text.indexOf(MASTER);
  if (idx < 0) throw new Error(`${MASTER} not found in keys file`);
  const matches = [...text.slice(idx).matchAll(/ed25519:([1-9A-HJ-NP-Za-km-z]+)/g)].map((m) => m[0]);
  if (matches.length < 2) throw new Error('could not parse master keys');
  const keyPair = KeyPair.fromString(matches[1]); // matches[0]=public, matches[1]=secret
  if (keyPair.getPublicKey().toString() !== matches[0]) throw new Error('parsed secret does not match parsed public key');
  if (matches[0] !== MASTER_PUBLIC_KEY) throw new Error(`master public key drifted: ${matches[0]}`);
  return keyPair;
}

function extractResult(outcome) {
  // Returns { signatureResponse } or { failure } or {} if not final yet.
  const receipts = outcome.receipts_outcome || [];
  for (const r of receipts) {
    const st = r.outcome && r.outcome.status;
    if (!st) continue;
    if (typeof st.SuccessValue === 'string' && st.SuccessValue.length > 0) {
      const decoded = Buffer.from(st.SuccessValue, 'base64').toString('utf8');
      try { return { signatureResponse: JSON.parse(decoded), rawSuccessValue: decoded }; }
      catch { return { rawSuccessValue: decoded }; }
    }
    if (st.Failure) return { failure: st.Failure };
  }
  const st = outcome.status || {};
  if (st.Failure) return { failure: st.Failure };
  if (typeof st.SuccessValue === 'string' && st.SuccessValue) {
    const decoded = Buffer.from(st.SuccessValue, 'base64').toString('utf8');
    try { return { signatureResponse: JSON.parse(decoded), rawSuccessValue: decoded }; }
    catch { return { rawSuccessValue: decoded }; }
  }
  return {};
}

async function main() {
  const mode = process.argv[2] || 'sign';
  const provider = new JsonRpcProvider({ url: RPC_URL });
  const keyPair = loadMasterKeyPair();
  const signer = KeyPairSigner.fromSecretKey(keyPair.toString());
  const account = new Account(MASTER, provider, signer);

  const balBefore = await provider.viewAccount({ accountId: MASTER });
  console.log(`master balance before: ${balBefore.amount} yocto`);

  let txHash = process.argv[3] || null;
  // The deployed v1.signer-prod.testnet requires the { request: {...} }
  // wrapper (proven on-chain 2026-11-13: the flat shape failed with
  // "missing field `request`", tx FvAHsNLzQc3Dr77Bd677fu7fDBqrLHuJp2Uj1kiuarUb).
  const style = process.env.SIGN_ARGS || 'req-payload';
  const depositNear = process.env.SIGN_DEPOSIT_NEAR || '1';

  if (mode === 'sign') {
    if (!ARGS_STYLES[style]) throw new Error(`unknown SIGN_ARGS style ${style}`);
    const args = ARGS_STYLES[style]();
    const action = actions.functionCall(
      'sign',
      new TextEncoder().encode(JSON.stringify(args)),
      300_000_000_000_000n, // 300 TGas
      BigInt(parseNearAmount(depositNear)),
    );
    const signedTx = await account.createSignedTransaction({ receiverId: MPC_CONTRACT, actions: [action] });
    const submitted = await provider.sendTransactionUntil(signedTx, 'EXECUTED_OPTIMISTIC');
    txHash = submitted.transaction.hash;
    console.log(`sign tx submitted: ${txHash} (args style=${style}, deposit=${depositNear} NEAR)`);
    const early = extractResult(submitted);
    if (early.signatureResponse || early.failure) {
      console.log('final already at submission:', JSON.stringify(early).slice(0, 400));
    }
  }
  if (!txHash) throw new Error('no tx hash');

  // Poll until FINAL with the raw JSON-RPC `tx` method: the MPC call yields,
  // MPC nodes sign off-chain, then a response tx resumes the promise and the
  // receipt gains a SuccessValue.
  const deadline = Date.now() + 6 * 60 * 1000;
  let found = {};
  let lastOutcome = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'poll', method: 'tx', params: { tx_hash: txHash, sender_account_id: MASTER, wait_until: 'FINAL' } }),
      });
      const body = await res.json();
      if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 200));
      lastOutcome = body.result;
      found = extractResult(lastOutcome);
      if (found.signatureResponse || found.failure) break;
      console.log(`[${new Date().toISOString()}] still waiting for MPC resume... receipts: ${(lastOutcome.receipts_outcome || []).length}`);
    } catch (e) {
      console.log(`[${new Date().toISOString()}] poll error (will retry): ${String(e.message || e).slice(0, 160)}`);
    }
    await new Promise((r) => setTimeout(r, 6000));
  }

  const balAfter = await provider.viewAccount({ accountId: MASTER });
  const evidence = {
    kind: 'near-chain-signatures-mpc-sign-evidence',
    network: 'testnet',
    mpc_contract: MPC_CONTRACT,
    signer_account: MASTER,
    derivation_path: PATH,
    message: MESSAGE,
    payload_sha256_hex: PAYLOAD.toString('hex'),
    payload_bytes: PAYLOAD_ARRAY,
    args_style: style,
    deposit_attached_near: depositNear,
    sign_tx_hash: txHash,
    explorer_url: `https://testnet.nearblocks.io/txns/${txHash}`,
    signature_response: found.signatureResponse || null,
    raw_success_value: found.rawSuccessValue || null,
    failure: found.failure || null,
    master_balance_before_yocto: String(balBefore.amount),
    master_balance_after_yocto: String(balAfter.amount),
    fetched_at: new Date().toISOString(),
  };
  fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(evidence, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  console.log(`evidence saved to ${EVIDENCE_FILE}`);
  console.log(`master balance after: ${balAfter.amount} yocto`);
  if (found.signatureResponse) {
    console.log('SIGNATURE RESPONSE:', JSON.stringify(found.signatureResponse));
  } else if (found.failure) {
    console.log('EXECUTION FAILURE:', JSON.stringify(found.failure).slice(0, 800));
    process.exitCode = 3;
  } else {
    console.log('NO SIGNATURE YET after polling window. Tx outcome status:', JSON.stringify(lastOutcome && lastOutcome.status));
    process.exitCode = 4;
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
