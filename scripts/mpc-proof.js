'use strict';
/**
 * OmniPerps Swarm — MPC signature proof (zero-dependency, judges can run it).
 *
 * Fetches the REAL Chain Signatures `sign` transaction outcome live from
 * NEAR testnet RPC, extracts the signature the MPC network returned, and
 * verifies it two ways against the payload that was signed:
 *   1. ECDSA verify against the derived child public key
 *      (z/s·G + r/s·Q must reproduce big_r), and
 *   2. Ethereum ecrecover using the contract's `recovery_id`
 *      (must recover the swarm master's derived EVM address
 *       0x28ece91f7e9506d4c6f6a8d36db270d4ec1a688d).
 *
 * Run:  node scripts/mpc-proof.js
 * (Optionally pass a different sign tx hash as argv[2].)
 *
 * The sign request itself was submitted with tools/near-tools/mpc-sign.js
 * (tooling-only, uses near-api-js; keys never enter this repo).
 */
const crypto = require('node:crypto');
const { rpc, TESTNET_RPC, deriveEvmAddress } = require('../src/near-proof');

const SIGN_TX_HASH = process.argv[2] || 'E9TZrQ3wVWFSoED61XKi1HowPi6w4XB5fDnMykWZpX8b';
const SIGNER_ACCOUNT = 'omniperps-swarm.testnet';
const DERIVATION_PATH = 'ethereum-1';
const MESSAGE = 'OmniPerps Swarm - NEAR HACKATHON demo payload: MPC signature proof over a BTC-PERP settlement intent (paper trade, no real funds). Master: omniperps-swarm.testnet, path: ethereum-1.';

// --- secp256k1 (BigInt, self-contained) ---
const P = BigInt('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f');
const N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
const G = {
  x: BigInt('0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),
  y: BigInt('0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8'),
};
const mod = (a, m = P) => ((a % m) + m) % m;
function modInv(a, m = P) { let r = 1n, b = mod(a, m), e = m - 2n; while (e) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; }
function modPow(a, e, m = P) { let r = 1n, b = mod(a, m); while (e) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; }
function pointAdd(a, b) {
  if (!a) return b; if (!b) return a;
  if (a.x === b.x && mod(a.y + b.y) === 0n) return null;
  const l = a.x === b.x ? mod(3n * a.x * a.x * modInv(2n * a.y)) : mod((b.y - a.y) * modInv(b.x - a.x));
  const x = mod(l * l - a.x - b.x);
  return { x, y: mod(l * (a.x - x) - a.y) };
}
function pointMul(k, pt = G) { k = mod(k, N); let r = null, a = pt; while (k) { if (k & 1n) r = pointAdd(r, a); a = pointAdd(a, a); k >>= 1n; } return r; }
const pointNeg = (a) => a && { x: a.x, y: mod(-a.y) };
const hex64 = (bn) => bn.toString(16).padStart(64, '0');
function pointToEvmAddress(pt) {
  const hash = crypto.createHash('keccak-256').update(Buffer.from(hex64(pt.x) + hex64(pt.y), 'hex')).digest('hex');
  return '0x' + hash.slice(-40);
}
function decompress(compressedHex, parityBit) {
  const buf = Buffer.from(compressedHex, 'hex');
  if (buf.length !== 33) throw new Error(`expected 33-byte compressed point, got ${buf.length}`);
  const x = BigInt('0x' + buf.subarray(1).toString('hex'));
  let y = modPow(mod(x * x * x + 7n), (P + 1n) / 4n);
  if (Number(y & 1n) !== parityBit) y = P - y;
  return { x, y };
}

async function main() {
  const payload = crypto.createHash('sha256').update(MESSAGE, 'utf8').digest();
  console.log('payload (sha256 of the labelled demo message):', payload.toString('hex'));
  console.log('sign tx:', SIGN_TX_HASH);
  console.log('fetching tx outcome from', TESTNET_RPC, '...');

  const outcome = await rpc(TESTNET_RPC, 'tx', { tx_hash: SIGN_TX_HASH, sender_account_id: SIGNER_ACCOUNT, wait_until: 'FINAL' });
  let sigJson = null;
  for (const r of outcome.receipts_outcome || []) {
    const st = r.outcome && r.outcome.status;
    if (st && typeof st.SuccessValue === 'string' && st.SuccessValue) {
      const decoded = Buffer.from(st.SuccessValue, 'base64').toString('utf8');
      try { const parsed = JSON.parse(decoded); if (parsed && parsed.big_r) sigJson = parsed; } catch { /* not the sign receipt */ }
    }
  }
  if (!sigJson) { console.error('FAIL: no signature response found in tx outcome'); process.exit(1); }
  console.log('signature response from MPC contract:', JSON.stringify(sigJson));

  const r = mod(BigInt('0x' + Buffer.from(sigJson.big_r.affine_point, 'hex').subarray(1).toString('hex')), N);
  const s = BigInt('0x' + sigJson.s.scalar);
  const z = BigInt('0x' + payload.toString('hex'));
  const recoveryId = sigJson.recovery_id;
  console.log(`r = ${hex64(r)}\ns = ${hex64(s)}\nrecovery_id = ${recoveryId}`);

  // Expected key/address from the client-side derivation (src/near-proof.js)
  const derived = deriveEvmAddress(SIGNER_ACCOUNT, DERIVATION_PATH, { network: 'testnet' });
  const rawPub = Buffer.from(derived.derived_public_key_uncompressed, 'hex');
  const Q = { x: BigInt('0x' + rawPub.subarray(1, 33).toString('hex')), y: BigInt('0x' + rawPub.subarray(33, 65).toString('hex')) };
  console.log('expected EVM address (derived):', derived.evm_address);

  // 1) ECDSA verify: implied R = z/s·G + r/s·Q must have x == big_r.x
  const sInv = modInv(s, N);
  const impliedR = pointAdd(pointMul(mod(z * sInv, N)), pointMul(mod(r * sInv, N), Q));
  const verifyOk = impliedR && impliedR.x === BigInt('0x' + Buffer.from(sigJson.big_r.affine_point, 'hex').subarray(1).toString('hex'));
  console.log('ECDSA verify against derived public key:', verifyOk ? 'PASS' : 'FAIL');

  // 2) ecrecover with the contract-provided recovery_id (Ethereum convention:
  //    recovery_id is the parity of the R point used for recovery).
  const R = decompress(sigJson.big_r.affine_point, recoveryId & 1);
  const recovered = pointMul(modInv(r, N), pointAdd(pointMul(s, R), pointNeg(pointMul(z))));
  const recoveredAddr = pointToEvmAddress(recovered);
  console.log('ecrecover address:', recoveredAddr);
  const recoverOk = recoveredAddr.toLowerCase() === derived.evm_address.toLowerCase();
  console.log('ecrecover matches derived EVM address:', recoverOk ? 'PASS' : 'FAIL');

  if (verifyOk && recoverOk) {
    console.log('\n*** MPC SIGNATURE VERIFIED: the NEAR MPC network really signed this payload for', derived.evm_address, '***');
  } else {
    console.error('\n*** VERIFICATION FAILED ***');
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
