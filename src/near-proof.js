'use strict';
/**
 * OmniPerps Swarm — NEAR leg (zero-dependency, Node >= 18, uses global fetch
 * and Node built-in `crypto` only: sha3-256 / keccak-256).
 *
 * What is real here:
 *  - Live JSON-RPC reads against NEAR testnet (and mainnet for the MPC root key).
 *  - Client-side Chain Signatures address derivation, implemented from the
 *    official near/mpc epsilon-derivation scheme as used by chainsig.js
 *    (NearDeFi/chainsig.js `src/utils/cryptography.ts`, fetched 2026-11-13):
 *        tweak  = sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:"
 *                          + predecessorId + "," + path)
 *        child  = rootPoint + tweak * G          (secp256k1, additive derivation)
 *        evmAddr= last 20 bytes of keccak256(childX || childY)
 *    Validated in this file's self-test against chainsig.js's vector captured
 *    from the live testnet MPC contract (reproduces exactly). The docs'
 *    example.near mainnet examples do not reproduce under today's mainnet
 *    root key — see verifyDerivationVectors() / docs/NEAR_PROOF.md.
 *
 * What is NOT here: no MPC `sign` call is made (that needs a funded NEAR
 * account signing a transaction), and no NEAR Intents execution is performed.
 * `buildSettlementIntent` only *produces* an intent JSON object.
 */
const crypto = require('node:crypto');

const TESTNET_RPC = 'https://rpc.testnet.near.org';
const MAINNET_RPC = 'https://rpc.mainnet.near.org';

// MPC signer contracts (docs.near.org/chain-abstraction/chain-signatures)
const MPC_CONTRACTS = { mainnet: 'v1.signer', testnet: 'v1.signer-prod.testnet' };
// Root secp256k1 public keys — fetched live from `public_key` on each contract
// on 2026-11-13 (see docs/NEAR_PROOF.md) and identical to the constants pinned
// in chainsig.js `src/constants.ts` (ROOT_PUBLIC_KEYS).
const MPC_ROOT_PUBLIC_KEYS = {
  mainnet: 'secp256k1:3tFRbMqmoa6AAALMrEFAYCEoHcqKxeW38YptwowBVBtXK1vo36HDbUWuR6EZmoK4JcH6HDkNMGGqP1ouV7VZUWya',
  testnet: 'secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3',
};

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------
async function rpc(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'omniperps', method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${rpcUrl} HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`RPC error: ${JSON.stringify(body.error).slice(0, 500)}`);
  return body.result;
}

const testnetRpc = (method, params) => rpc(TESTNET_RPC, method, params);

async function callView(rpcUrl, accountId, methodName, args = {}) {
  const result = await rpc(rpcUrl, 'query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: accountId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  if (result.error) throw new Error(`view ${accountId}/${methodName}: ${result.error}`);
  return JSON.parse(Buffer.from(result.result).toString('utf8'));
}

// ---------------------------------------------------------------------------
// 1. Live testnet proofs
// ---------------------------------------------------------------------------
async function getTestnetStatus() {
  const status = await testnetRpc('status', []);
  return {
    network: 'testnet',
    fetchedAt: new Date().toISOString(),
    chain_id: status.chain_id,
    latest_block_height: status.sync_info.latest_block_height,
    latest_block_hash: status.sync_info.latest_block_hash,
    latest_block_time: status.sync_info.latest_block_time,
    syncing: status.sync_info.syncing,
    node_version: status.version && status.version.version,
    protocol_version: status.latest_protocol_version,
  };
}

async function getLatestBlock() {
  const block = await testnetRpc('block', { finality: 'final' });
  return {
    network: 'testnet',
    fetchedAt: new Date().toISOString(),
    height: block.header.height,
    hash: block.header.hash,
    timestamp_iso: new Date(Number(BigInt(block.header.timestamp_nanosec) / 1000000n)).toISOString(),
    author: block.author,
  };
}

async function viewAccount(accountId, rpcUrl = TESTNET_RPC) {
  const acct = await rpc(rpcUrl, 'query', {
    request_type: 'view_account',
    finality: 'final',
    account_id: accountId,
  });
  return {
    account_id: accountId,
    fetchedAt: new Date().toISOString(),
    amount_yoctonear: acct.amount,
    amount_near: (Number(BigInt(acct.amount) / 1000000000000000000n) / 1e6).toFixed(6),
    locked_yoctonear: acct.locked,
    code_hash: acct.code_hash,
    storage_usage: acct.storage_usage,
    block_height: acct.block_height,
    block_hash: acct.block_hash,
  };
}

async function getMpcPublicKey(network = 'mainnet') {
  const rpcUrl = network === 'mainnet' ? MAINNET_RPC : TESTNET_RPC;
  const contractId = MPC_CONTRACTS[network];
  const publicKey = await callView(rpcUrl, contractId, 'public_key', {});
  return { network, contract_id: contractId, fetchedAt: new Date().toISOString(), public_key: publicKey };
}

// ---------------------------------------------------------------------------
// base58 (Bitcoin alphabet) — decode/encode, no dependency
// ---------------------------------------------------------------------------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Decode(str) {
  let zeros = 0; while (zeros < str.length && str[zeros] === '1') zeros++;
  const bytes = [0];
  for (const ch of str) {
    const v = B58.indexOf(ch); if (v < 0) throw new Error(`bad base58 char ${ch}`);
    let carry = v;
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(bytes.reverse())]);
}
function base58Encode(buf) {
  let zeros = 0; while (zeros < buf.length && buf[zeros] === 0) zeros++;
  const digits = [0];
  for (const byte of buf) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) { carry += digits[i] << 8; digits[i] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  return '1'.repeat(zeros) + digits.reverse().map((d) => B58[d]).join('');
}

// ---------------------------------------------------------------------------
// secp256k1 point arithmetic with BigInt (affine, only what derivation needs)
// ---------------------------------------------------------------------------
const P = BigInt('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f');
const N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
const GX = BigInt('0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
const GY = BigInt('0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8');
const mod = (a, m = P) => ((a % m) + m) % m;
function modInv(a, m = P) { // Fermat, m prime
  let r = 1n, base = mod(a, m), e = m - 2n;
  while (e) { if (e & 1n) r = (r * base) % m; base = (base * base) % m; e >>= 1n; }
  return r;
}
function pointAdd(a, b) {
  if (!a) return b; if (!b) return a;
  if (a.x === b.x && mod(a.y + b.y) === 0n) return null;
  const lambda = a.x === b.x
    ? mod(3n * a.x * a.x * modInv(2n * a.y))
    : mod((b.y - a.y) * modInv(b.x - a.x));
  const x = mod(lambda * lambda - a.x - b.x);
  return { x, y: mod(lambda * (a.x - x) - a.y) };
}
function pointMul(k, pt = { x: GX, y: GY }) {
  k = mod(k, N); let res = null, addend = pt;
  while (k) { if (k & 1n) res = pointAdd(res, addend); addend = pointAdd(addend, addend); k >>= 1n; }
  return res;
}
const hex64 = (bn) => bn.toString(16).padStart(64, '0');

function najToPoint(naj) { // "secp256k1:<base58 64-byte x||y>"
  const raw = base58Decode(naj.split(':')[1]);
  if (raw.length !== 64) throw new Error(`expected 64-byte root key, got ${raw.length}`);
  return { x: BigInt('0x' + raw.subarray(0, 32).toString('hex')), y: BigInt('0x' + raw.subarray(32).toString('hex')) };
}
function pointToNaj(pt) {
  return 'secp256k1:' + base58Encode(Buffer.from(hex64(pt.x) + hex64(pt.y), 'hex'));
}

// ---------------------------------------------------------------------------
// 3. Chain Signatures derivation (client-side, deterministic)
// ---------------------------------------------------------------------------
function computeTweakHex(predecessorId, path) {
  const EPSILON_DERIVATION_PREFIX = 'near-mpc-recovery v0.1.0 epsilon derivation:';
  return crypto.createHash('sha3-256').update(`${EPSILON_DERIVATION_PREFIX}${predecessorId},${path}`).digest('hex');
}

function deriveChildPublicKey(rootNaj, predecessorId, path = '') {
  const tweak = BigInt('0x' + computeTweakHex(predecessorId, path));
  const child = pointAdd(najToPoint(rootNaj), pointMul(tweak));
  return { uncompressedSec1: '04' + hex64(child.x) + hex64(child.y), naj: pointToNaj(child), point: child };
}

/**
 * Derives the EVM address controlled by a NEAR account at a derivation path.
 * Deterministic and verifiable offline — this does NOT request an MPC
 * signature. `network` selects which MPC root key (mainnet by default, as in
 * the published docs vectors). Use { rootPublicKey } to override with a key
 * fetched live via getMpcPublicKey().
 */
function deriveEvmAddress(nearAccountId, path = 'ethereum-1', opts = {}) {
  const network = opts.network || 'mainnet';
  const rootNaj = opts.rootPublicKey || MPC_ROOT_PUBLIC_KEYS[network];
  const child = deriveChildPublicKey(rootNaj, nearAccountId, path);
  const xy = Buffer.from(hex64(child.point.x) + hex64(child.point.y), 'hex');
  const hash = crypto.createHash('keccak-256').update(xy).digest('hex');
  return {
    near_account_id: nearAccountId,
    path,
    mpc_network: network,
    mpc_contract: MPC_CONTRACTS[network],
    mpc_root_public_key: rootNaj,
    derived_public_key_naj: child.naj,
    derived_public_key_uncompressed: child.uncompressedSec1,
    evm_address: '0x' + hash.slice(-40),
    labelled: 'DERIVED (deterministic, client-side) — no MPC signature requested or produced',
  };
}

// Self-test vectors (published / captured from the live contracts — see docs)
// PRIMARY validation: chainsig.js's vector captured from the live testnet MPC
// contract (v1.signer-prod.testnet) on 2026-04-30 — reproduces EXACTLY.
// The docs' example.near mainnet EVM examples do NOT reproduce under the
// mainnet root key fetched live on 2026-11-13 (they predate the current root
// key); that mismatch is reported, not hidden.
function verifyDerivationVectors() {
  const v1 = deriveEvmAddress('example.near', 'ethereum-1');
  const v2 = deriveEvmAddress('example.near', 'ethereum-2');
  const v3child = deriveChildPublicKey(MPC_ROOT_PUBLIC_KEYS.testnet, 'derivation-test.testnet', 'unit-test');
  const expectedChild = 'secp256k1:3b3GS4kaAPvzxFUEYKiMvXeuBzttMZosggT3iAAbyZzAfQc1Dn4eLrDshNGGeKZyfSK7xegjPSq553NXHisMLiyA';
  return {
    testnet_contract_vector: { got: v3child.naj, expected: expectedChild, pass: v3child.naj === expectedChild },
    docs_mainnet_examples_under_current_root: {
      example_near_ethereum_1: { got: v1.evm_address, docs_published: '0x1b48b83a308ea4beb845db088180dc3389f8aa3b', matches_current_mainnet_root: v1.evm_address === '0x1b48b83a308ea4beb845db088180dc3389f8aa3b' },
      example_near_ethereum_2: { got: v2.evm_address, docs_published: '0x99c5d3025dc736541f2d97c3ef3c90de4d221315', matches_current_mainnet_root: v2.evm_address === '0x99c5d3025dc736541f2d97c3ef3c90de4d221315' },
      note: 'Docs examples appear to predate the current v1.signer root key; child-key derivation itself is proven by the testnet contract vector above.',
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Settlement intent (PRODUCED by the swarm — NOT executed on Intents)
// ---------------------------------------------------------------------------
/**
 * NEAR Intents-style settlement intent for one perp trade.
 * token_diff convention follows the Intents verifier `intents` format:
 * negative = user gives, positive = user receives (amounts as decimal strings
 * in the token's smallest unit as supplied by the caller).
 */
function buildSettlementIntent({ side, sizeBtc, price, makerNearAccount, takerEvmAddress, nonce, deadlineMinutes = 10, now = new Date() } = {}) {
  if (!['long', 'short'].includes(side)) throw new Error('side must be "long" or "short"');
  if (!(Number(sizeBtc) > 0) || !(Number(price) > 0)) throw new Error('sizeBtc and price must be positive');
  const notionalUsd = Number(sizeBtc) * Number(price);
  const deadline = new Date(now.getTime() + deadlineMinutes * 60000).toISOString();
  return {
    standard: 'nep413',
    body: {
      signer_id: makerNearAccount || 'omniperps-swarm.testnet',
      verifying_contract: 'intents.near',
      deadline,
      nonce: nonce || base58Encode(crypto.randomBytes(32)),
      intents: [{
        intent: 'token_diff',
        diff: side === 'long'
          ? { 'nep141:usdt.tether-token.near': `-${Math.round(notionalUsd * 1e6)}`, 'nep141:btc.omni.near': `${Math.round(Number(sizeBtc) * 1e8)}` }
          : { 'nep141:btc.omni.near': `-${Math.round(Number(sizeBtc) * 1e8)}`, 'nep141:usdt.tether-token.near': `${Math.round(notionalUsd * 1e6)}` },
        referral: 'omniperps-swarm',
      }],
    },
    meta: {
      app: 'OmniPerps Swarm',
      trade: { side, size_btc: String(sizeBtc), price_usd: String(price), notional_usd: notionalUsd.toFixed(2), counterparty_evm_address: takerEvmAddress || null },
      labelled: 'Intent PRODUCED by the swarm for settlement — NOT signed and NOT executed on NEAR Intents mainnet',
      produced_at: now.toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
async function collectProof() {
  const [status, block, testnetAccount, swarmMaster, mpcMainnet, mpcTestnet] = await Promise.all([
    getTestnetStatus(), getLatestBlock(), viewAccount('testnet'),
    viewAccount('omniperps-swarm.testnet').catch((e) => ({ error: String(e) })),
    getMpcPublicKey('mainnet'), getMpcPublicKey('testnet'),
  ]);
  return {
    status, block, testnetAccount, swarmMaster, mpcMainnet, mpcTestnet,
    derivationVectors: verifyDerivationVectors(),
    // The swarm master is a TESTNET account, so the testnet MPC root
    // (v1.signer-prod.testnet) is the derivation that actually controls funds.
    swarmDerivedEvmTestnetRoot: deriveEvmAddress('omniperps-swarm.testnet', 'ethereum-1', { network: 'testnet' }),
    swarmDerivedEvmMainnetRoot: deriveEvmAddress('omniperps-swarm.testnet', 'ethereum-1'),
    sampleIntent: buildSettlementIntent({ side: 'long', sizeBtc: '0.01', price: '97500', takerEvmAddress: deriveEvmAddress('omniperps-swarm.testnet', 'ethereum-1', { network: 'testnet' }).evm_address }),
  };
}

module.exports = {
  TESTNET_RPC, MAINNET_RPC, MPC_CONTRACTS, MPC_ROOT_PUBLIC_KEYS,
  rpc, getTestnetStatus, getLatestBlock, viewAccount, getMpcPublicKey,
  base58Decode, base58Encode, computeTweakHex, deriveChildPublicKey,
  deriveEvmAddress, verifyDerivationVectors, buildSettlementIntent, collectProof,
};

if (require.main === module) {
  collectProof().then((p) => console.log(JSON.stringify(p, null, 2))).catch((e) => { console.error(e); process.exit(1); });
}
