'use strict';
/**
 * OmniPerps Swarm — minimal NEAR transaction client (zero-dependency).
 *
 * Just enough to submit signed FunctionCall transactions from Node with
 * built-ins only: Borsh serialization of a NEAR transaction, sha256 tx
 * hash, Ed25519 signing via `node:crypto` (the NEAR secret key is
 * base58(seed||publicKey); the seed is wrapped in a PKCS#8 DER envelope),
 * and broadcast via the JSON-RPC `send_tx` method.
 *
 * Used by scripts/guard-proof.js to exercise the deployed SpendGuard
 * contract. Keys are read by the caller from OUTSIDE the repo — this
 * module never stores or logs key material.
 */
const crypto = require('node:crypto');
const { rpc, TESTNET_RPC, base58Decode } = require('./near-proof');

// ---------------------------------------------------------------------------
// Borsh writer (only the types a FunctionCall transaction needs)
// ---------------------------------------------------------------------------
class Writer {
  constructor() { this.parts = []; }
  u8(v) { this.parts.push(Buffer.from([v])); return this; }
  u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v); this.parts.push(b); return this; }
  u64(v) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); this.parts.push(b); return this; }
  u128(v) {
    const b = Buffer.alloc(16); let x = BigInt(v);
    for (let i = 0; i < 16; i++) { b[i] = Number(x & 0xffn); x >>= 8n; }
    this.parts.push(b); return this;
  }
  raw(buf) { this.parts.push(Buffer.from(buf)); return this; }
  string(s) { const b = Buffer.from(s, 'utf8'); return this.u32(b.length).raw(b); }
  bytesWithLen(buf) { return this.u32(buf.length).raw(buf); }
  build() { return Buffer.concat(this.parts); }
}

function serializePublicKey(pubKeyBytes32) {
  return new Writer().u8(0).raw(pubKeyBytes32).build(); // 0 = ED25519
}

function serializeFunctionCallAction({ methodName, args, gas, deposit }) {
  return new Writer()
    .u8(2) // Action enum: FunctionCall
    .string(methodName)
    .bytesWithLen(Buffer.isBuffer(args) ? args : Buffer.from(JSON.stringify(args), 'utf8'))
    .u64(gas)
    .u128(deposit)
    .build();
}

function serializeTransferAction({ deposit }) {
  return new Writer()
    .u8(3) // Action enum: Transfer
    .u128(deposit)
    .build();
}

function serializeTransaction({ signerId, publicKeyBytes, nonce, receiverId, blockHashBytes, actions }) {
  const w = new Writer()
    .string(signerId)
    .raw(serializePublicKey(publicKeyBytes))
    .u64(nonce)
    .string(receiverId)
    .raw(blockHashBytes)
    .u32(actions.length);
  for (const a of actions) w.raw(a);
  return w.build();
}

// ---------------------------------------------------------------------------
// Ed25519 signing from a NEAR secret key string ("ed25519:base58(seed||pub)")
// ---------------------------------------------------------------------------
function keyObjectsFromNearSecret(secretKeyString) {
  const raw = base58Decode(secretKeyString.replace(/^ed25519:/, ''));
  if (raw.length !== 64) throw new Error(`expected 64-byte NEAR secret, got ${raw.length}`);
  const seed = raw.subarray(0, 32);
  const publicKeyBytes = raw.subarray(32, 64);
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  const privateKey = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  return { privateKey, publicKeyBytes };
}

// ---------------------------------------------------------------------------
// High-level: sign + broadcast a transaction with the given actions
// ---------------------------------------------------------------------------
async function submitActions({ signerId, secretKeyString, publicKeyString, receiverId, actions, rpcUrl = TESTNET_RPC }) {
  const { privateKey, publicKeyBytes } = keyObjectsFromNearSecret(secretKeyString);
  const expectedPub = base58Decode(publicKeyString.replace(/^ed25519:/, ''));
  if (!expectedPub.equals(Buffer.from(publicKeyBytes))) throw new Error('secret key does not match the given public key');

  const accessKey = await rpc(rpcUrl, 'query', {
    request_type: 'view_access_key', finality: 'final',
    account_id: signerId, public_key: publicKeyString,
  });
  const block = await rpc(rpcUrl, 'block', { finality: 'final' });
  const blockHashBytes = base58Decode(block.header.hash);

  const txBytes = serializeTransaction({
    signerId, publicKeyBytes, nonce: BigInt(accessKey.nonce) + 1n,
    receiverId, blockHashBytes, actions,
  });
  const txHash = crypto.createHash('sha256').update(txBytes).digest();
  const signature = crypto.sign(null, txHash, privateKey);
  const signedTxBytes = Buffer.concat([txBytes, new Writer().u8(0).raw(signature).build()]);

  const outcome = await rpc(rpcUrl, 'send_tx', {
    signed_tx_base64: signedTxBytes.toString('base64'), wait_until: 'FINAL',
  });
  return { txHash: base58EncodeTxHash(txHash), outcome };
}

async function callFunctionSigned({ signerId, secretKeyString, publicKeyString, contractId, methodName, args, gas = 30_000_000_000_000n, deposit = 0n, rpcUrl = TESTNET_RPC }) {
  const action = serializeFunctionCallAction({ methodName, args, gas, deposit });
  return submitActions({ signerId, secretKeyString, publicKeyString, receiverId: contractId, actions: [action], rpcUrl });
}

/** Plain NEAR transfer (one Transfer action). amountYocto is a BigInt. */
async function transferSigned({ signerId, secretKeyString, publicKeyString, receiverId, amountYocto, rpcUrl = TESTNET_RPC }) {
  if (!(BigInt(amountYocto) > 0n)) throw new Error('transfer amount must be > 0');
  const action = serializeTransferAction({ deposit: BigInt(amountYocto) });
  return submitActions({ signerId, secretKeyString, publicKeyString, receiverId, actions: [action], rpcUrl });
}

function base58EncodeTxHash(buf) {
  const { base58Encode } = require('./near-proof');
  return base58Encode(buf);
}

/** Extract the JSON return value of the (single) function call, or throw with the on-chain failure. */
function functionCallResult(outcome) {
  const st = outcome.status || {};
  if (st.Failure) throw new Error(`tx failed: ${JSON.stringify(st.Failure).slice(0, 500)}`);
  for (const r of outcome.receipts_outcome || []) {
    const s = r.outcome && r.outcome.status;
    if (s && typeof s.SuccessValue === 'string' && s.SuccessValue) {
      const decoded = Buffer.from(s.SuccessValue, 'base64').toString('utf8');
      try { return JSON.parse(decoded); } catch { return decoded; }
    }
    if (s && s.Failure) throw new Error(`call failed: ${JSON.stringify(s.Failure).slice(0, 500)}`);
  }
  return null;
}

module.exports = { callFunctionSigned, transferSigned, functionCallResult, keyObjectsFromNearSecret };
