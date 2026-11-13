# OmniPerps Swarm — NEAR Proof

All values below were fetched live from the wire on **2026-11-13 ~19:43–19:44 UTC**
by running `node src/near-proof.js` (zero-dependency Node, plain `fetch` JSON-RPC).
Nothing in the "LIVE" section is invented or hard-coded as a result — re-running
the module re-fetches and will show newer block heights.

**Upgrade, same night (~20:08–20:23 UTC):** a REAL MPC signature was requested
from the testnet Chain Signatures contract and cryptographically verified,
and the SpendGuard policy was deployed as a REAL NEAR testnet contract and
exercised live. Both are documented in their own sections below, with
judge-reproducible proof scripts (`scripts/mpc-proof.js`,
`scripts/guard-proof.js`).

Code: [`src/near-proof.js`](../src/near-proof.js) — exports `getTestnetStatus`,
`getLatestBlock`, `viewAccount`, `getMpcPublicKey`, `deriveEvmAddress`,
`deriveChildPublicKey`, `buildSettlementIntent`, `collectProof`.

---

## What is LIVE

### NEAR testnet RPC — `https://rpc.testnet.near.org`

| Field | Real value (fetched 2026-11-13T19:43:47Z) |
|---|---|
| chain_id | `testnet` |
| latest_block_height (status) | `277554610` |
| latest_block_hash (status) | `9eo9nWztWwaNqhUyavRrQLueXfL1CnS7jXDw6RKLXcEU` |
| latest_block_time | `2026-11-13T19:43:46.772870018Z` |
| syncing | `false` |
| node version / protocol | `2.14.1` / `88` |
| final block (separate `block` call) | height `277554608`, hash `ANuBj3mgpHr6tevNXC1mtN5vmdndERzt656uY7EyvAho`, author `node1` |

### Well-known testnet account — `testnet` (view_account, same run)

- amount: `812045391850173833509405522924` yoctoNEAR (≈ 812045.391850 NEAR)
- locked: `0`, code_hash: `AjT2jpkGZaWeopfaP4wj7aFDNUBLFvFmSNUaVdKZJBPf`, storage_usage: `1188019`
- at block height `277554608`

### Swarm testnet accounts — CREATED and verified on-chain (see Attempted)

| Account | Balance (verified via RPC) | Creation tx hash | Public key |
|---|---|---|---|
| `omniperps-swarm.testnet` (master) | 10.000000 NEAR (`10000000000000000000000000` yocto) | `C4W5GTS4UZqKcUkhKfgkEred7WKctGy3axtTsJLZWAa2` | `ed25519:FwGz4NS2y4qDvVA3aQzF1zLSbriVBctQfbKjEv3wQkL2` |
| `omniperps-agent1-7f3a.testnet` | 10.000000 NEAR | `HnqXv26ZRV16tW7Vk8So1SfkddYAfhv4CBXhG7k5Dihy` | `ed25519:483swe9kZbz1QYb6F4bVtmF4xKSpwrAT8uj2rUvpNFiE` |
| `omniperps-agent2-7f3a.testnet` | 10.000000 NEAR | `s8Pesx8Mqp55STZiog7o7gQvMNPiHmtxwUrQVdhqfan` | `ed25519:57dsj9E1gzD1bAgPFF7L4DPZM9G1eoEqozz96mF3bFR2` |

Master verified at block `277554608`; agents verified at blocks `277554626` / `277554631`
(code_hash `11111111111111111111111111111111` = no contract deployed, storage_usage 182).
Private keys were generated locally for these three accounts and handed to the
coordinator out-of-band — they are **not** committed to this repo.
Verify any of them: `view_account` on `https://rpc.testnet.near.org`, or NearBlocks testnet explorer by tx hash.

### MPC signer root public keys — fetched live via `public_key` view call

- Mainnet `v1.signer`: `secp256k1:3tFRbMqmoa6AAALMrEFAYCEoHcqKxeW38YptwowBVBtXK1vo36HDbUWuR6EZmoK4JcH6HDkNMGGqP1ouV7VZUWya`
- Testnet `v1.signer-prod.testnet`: `secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3`

Both match the constants pinned in chainsig.js (`ROOT_PUBLIC_KEYS`).

### MPC signature — PRODUCED by the MPC network and VERIFIED (2026-11-13 ~20:15 UTC)

A real `sign` request was submitted from the swarm master to the testnet
Chain Signatures contract `v1.signer-prod.testnet` for path `ethereum-1`,
over a clearly-labelled demo payload: the sha256 of the message
*"OmniPerps Swarm - NEAR HACKATHON demo payload: MPC signature proof over a
BTC-PERP settlement intent (paper trade, no real funds). Master:
omniperps-swarm.testnet, path: ethereum-1."*

| Field | Value |
|---|---|
| Sign tx hash | `E9TZrQ3wVWFSoED61XKi1HowPi6w4XB5fDnMykWZpX8b` |
| Payload (sha256, hex) | `10929e760c75c6837c69d24f5e8c9deb0e177c7b3d0fc26824dd948283290353` |
| Args shape | `{ request: { payload: [32 bytes], path: "ethereum-1", key_version: 0 } }`, 300 TGas, 1 NEAR deposit attached |
| Signature `big_r` (affine point, compressed) | `035eb0d9ce65640b3e315308ce73e4eb9a90a52d261c6aa71b65c1f960f30babc2` |
| Signature `s` (scalar) | `5ed1aba513ce2c0715b5d71391931292f57d36c85e451b7008a218c9c4bcb653` |
| `recovery_id` | `0` |
| Net cost | ≈ 0.00092 NEAR (master 9.9997537588960536 → 9.9988293871788309 NEAR across the request; the 1 NEAR deposit came back to the master, less the signature fee + gas). A preceding failed args probe cost ≈ 0.00025 NEAR gas (below). Total upgrade spend ≈ 0.00117 testnet NEAR. |

**Verification (reproduce with `node scripts/mpc-proof.js`, zero-dependency):**
the script re-fetches the tx outcome live from testnet RPC, extracts the
signature, and checks it two independent ways against the payload —
(1) ECDSA verify against the derived child public key
(`z/s·G + r/s·Q` reproduces `big_r`), and (2) Ethereum **ecrecover** using
the contract's `recovery_id`, which recovers exactly
**`0x28ece91f7e9506d4c6f6a8d36db270d4ec1a688d`** — the derived EVM address.
Both PASS. (One nuance, recorded honestly: the parity bit of the compressed
`big_r` point as serialised by the contract disagrees with `recovery_id`;
`recovery_id` is the authoritative recovery parity — using it is what
recovers the derived address, which is the standard Ethereum convention.
The ECDSA verification against the derived key holds regardless of parity.)
The sign request was submitted with the tooling script
`tools/near-tools/mpc-sign.js` (near-api-js; tooling only, keys read from
the coordinator-held file outside this repo).

### SpendGuard contract — DEPLOYED on NEAR testnet and exercised live (2026-11-13 ~20:19–20:22 UTC)

The policy in `src/policy.js` is now also a real smart contract:
**`guard.omniperps-swarm.testnet`**, written in TypeScript with
near-sdk-js 2.0.0 (source: `contracts/spendguard/src/contract.ts`, built
WASM 531,573 bytes), owner = `omniperps-swarm.testnet`. State mirrors
`DEFAULT_LIMITS` exactly (cap 25000, leverage 10, min liquidation distance
12%, daily loss 5000, killed=false).

| Step | Tx hash |
|---|---|
| Create sub-account (funded 7 NEAR from master) | `k7rM6ZZggWydrGfqvtxTxEZy8Pei2izCXFhfVZvNUo1` |
| Deploy contract code (code_hash after: `3oZeUS3bzTQji3LtuaW3en8Ew7U2Uz8Xb87JpAVGyc2g`) | `7jJBFKYc8QGEfWy8yy8386uGvqhQb2wEohZUZ6mmTjdB` |
| `init({ owner: "omniperps-swarm.testnet" })` | `6HuYZBwPfZL2d6Vojv8URFWW1U8mzYw8XZebwN9z7Fju` |

**Live checks against the deployed contract** — reproduce with
`node scripts/guard-proof.js` (zero-dependency; signed calls use the
hand-rolled Borsh+Ed25519 client in `src/near-tx.js` and the demo key from
the coordinator-held file outside the repo):

| Check | Result | Tx hash |
|---|---|---|
| `check_order` in-limit ($9,000, 5x, 40% liq distance, $0 daily loss) | `allowed: true` | `DFdxpfAPHGEDxwmUWf43neyEF1d9rASsAbGVN2PrRHoL` |
| `check_order` oversize ($40,000) | `allowed: false` — "notional 40000 exceeds per-order cap 25000" | `FJrLntEXpLnfDjSbqrXj4mszgy1daWYu8brfztuG12S2` |
| `set_killed(true)` by owner | `killed: true` | `BGsSMMHyGUAA2pQUEYcYYzSDDT6LVtwMovXpYa6C11Na` |
| `check_order` in-limit with kill switch ON | `allowed: false` — "KILL SWITCH is engaged" | `928KpuJpt65LhRzhqKVfu5zEpiGFPp1cDqkRiw5JP2hB` |
| `set_killed(false)` by owner | `killed: false` (left OFF) | `Ap1zedwqcJdVVXCuZjZg7d2UTpkpCCpPD9jRJyeW6hxT` |

`get_state` after the run: `checks_count = 3`, `killed = false`, limits as
above. Additionally, the dashboard server can log one LIVE `get_state`
read of this contract per decision cycle when started with
`OMNIPERPS_GUARD_CHAIN=1` (`src/guard-chain.js`; read-only, fail-safe,
off by default — smoke-tested both ways, see TESTS.md).

---

## What was ATTEMPTED

### Testnet account creation

1. **near-faucet.io** — `GET https://near-faucet.io/` → HTTP 200 (web UI).
   Guessed API POSTs (`/api/faucet`, `/api/request`, `/api/claim`) returned the
   Next.js HTML shell / no usable API (one timed out, HTTP 000). The faucet funds
   *existing* accounts through its UI; it is not the route used for creation.
2. **Legacy helper service — WORKED.** `POST https://helper.testnet.near.org/account`
   with `{newAccountId, newAccountPublicKey}` → **HTTP 200**,
   `final_execution_status: EXECUTED_OPTIMISTIC`, with a real CreateAccount +
   Transfer (10 NEAR) transaction for each of the three swarm accounts above
   (tx hashes in the table). No captcha, no pre-funded signer needed — the
   helper itself is the funded registrar-side service for testnet.
   - A first probe (`omniperps-probe.testnet`, placeholder key
     `ed25519:11111111111111111111111111111111`) also succeeded (HTTP 200, 10 NEAR,
     verified on-chain at block 277554403). **That probe account is NOT controlled
     by us** (bogus key) and is discarded — listed here only for honesty.
   - Candidate names checked first via `view_account` (all returned
     `UNKNOWN_ACCOUNT`, i.e. free): `omniperps-swarm.testnet`,
     `omni-perps-swarm.testnet`, `omniperps.testnet`, `omniperps-swarm-hq.testnet`,
     `omniperps-swarm-7f3a.testnet`, and the two agent names.
3. **`testnet` registrar / direct signed creation** — not attempted beyond the
   above: it needs an existing funded account to sign, and the helper route
   already succeeded, so there was no reason to spend the timebox on it.

### MPC `sign` calls (upgrade leg)

1. **Flat args shape — FAILED on-chain.** `sign({ payload, path, key_version })`
   (the shape in the near/mpc chain-signatures README) was rejected by the
   deployed `v1.signer-prod.testnet` with
   *"Smart contract panicked: Failed to deserialize input from JSON. Error:
   missing field `request`"* — tx
   `FvAHsNLzQc3Dr77Bd677fu7fDBqrLHuJp2Uj1kiuarUb`. The 1 NEAR deposit was
   fully refunded; only ≈ 0.00025 NEAR of gas was spent. Recorded here
   because the failure is what proved the deployed contract's real API.
2. **Wrapped args shape — SUCCEEDED.** `sign({ request: { payload, path,
   key_version } })` yielded to the MPC network and the resumed receipt
   returned the signature documented in the LIVE section above (tx
   `E9TZrQ3wVWFSoED61XKi1HowPi6w4XB5fDnMykWZpX8b`). No `payload_v2` enum
   wrapper was needed on this deployment.

### MPC `derived_public_key` view call

- With arg name `predecessor_id`: failed on both networks —
  `HostError(ProhibitedInView { method_name: "predecessor_account_id" })`
  (mainnet at block 224408570, testnet at block 277554305).
- With the correct arg name `predecessor` (as in chainsig.js): **succeeded** on
  testnet `v1.signer-prod.testnet` at block `277554654`, returning
  `secp256k1:4xuTMHCUkgeat2rEBb3TpLkErG8Uy738xgUMiobQLCuNM4oDkS6aqdwPAncjwpGj7PcmgWXVeBWyScSvM2Qjh2wB`
  for `omniperps-swarm.testnet` + `ethereum-1` — **byte-identical to the
  client-side derivation in `src/near-proof.js`**. The contract itself confirms it.

---

## What is DERIVED

**Method** (official near/mpc epsilon derivation, as implemented in
NearDeFi/chainsig.js `src/utils/cryptography.ts`, fetched 2026-11-13;
docs: docs.near.org/chain-abstraction/chain-signatures):

```
tweak   = sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:" + predecessorId + "," + path)
child   = rootPoint + tweak * G                       (secp256k1 additive derivation)
evmAddr = last 20 bytes of keccak256(childX || childY)
```

Implemented with Node built-ins only (`crypto` sha3-256 / keccak-256, BigInt
secp256k1 arithmetic, hand-rolled base58) in `deriveEvmAddress()`.

**Validation:**
- chainsig.js test vector captured from the live testnet contract on 2026-04-30
  (`derivation-test.testnet` + `unit-test`) reproduces **exactly** ✅
- The live testnet contract's own `derived_public_key` view returns the identical
  child key for our swarm master (see above) ✅
- The docs' `example.near` + `ethereum-1`/`ethereum-2` EVM examples
  (`0x1b48…aa3b`, `0x99c5…1315`) do **not** reproduce under the mainnet root key
  fetched live today (we get `0xef4ea05e5c11057decc8e1bd6f5369f2acd91fa5` /
  `0x273eeb4d7651d9296ec5bd9a6ceebca219101cb8`); they appear to predate the
  current `v1.signer` root key. Reported, not hidden.

**Swarm master derived EVM address (DERIVED — deterministic, verifiable):**

- NEAR account: `omniperps-swarm.testnet`, path: `ethereum-1`
- Via testnet MPC (`v1.signer-prod.testnet`, the signer that actually controls a
  testnet account's keys): **`0x28ece91f7e9506d4c6f6a8d36db270d4ec1a688d`**
  - derived public key: `secp256k1:4xuTMHCUkgeat2rEBb3TpLkErG8Uy738xgUMiobQLCuNM4oDkS6aqdwPAncjwpGj7PcmgWXVeBWyScSvM2Qjh2wB`
- Same account-id + path under the mainnet root (`v1.signer`), for reference only:
  `0x1accaeea9ca664406b3cec0226f33cf6d6ada9fb`

**Settlement intent (PRODUCED, not executed):** `buildSettlementIntent()` returns a
NEAR Intents-style `token_diff` intent JSON (NEP-413 envelope, `intents.near`
verifier, deadline + base58 nonce). Sample produced in the run output: long
0.01 BTC @ 97500 → diff `-975000000` (USDT, 6dp) / `+1000000` (BTC, 8dp),
signer `omniperps-swarm.testnet`. It is an object the swarm *produces* for
settlement — it has not been signed or submitted to Intents.

---

## What is NOT done

- **No NEAR Intents execution on mainnet.** The settlement intent is generated
  locally only; nothing was signed, broadcast, or settled on `intents.near`.
- **No EVM transaction has been broadcast from the derived address**, and the
  derived EVM address holds no funds. The MPC signature documented above was
  produced over the sha256 of a clearly-labelled demo message (a payload
  digest, exactly what the MPC signs) — it proves control of the derived
  address, but it is not a signed EVM transaction.
- **The swarm's runtime enforcement is still the off-chain module.** The
  deployed SpendGuard contract is a faithful on-chain mirror of
  `src/policy.js` and is exercised by `scripts/guard-proof.js`; the live
  server enforces the identical off-chain `SpendGuard` by default and only
  *reads* the contract (log-only, fail-safe) when run with
  `OMNIPERPS_GUARD_CHAIN=1`. Runtime cycles do not yet submit a signed
  `check_order` to the contract per order.
- The three swarm accounts themselves (master + agents) still have no
  contract code on them (code_hash is the empty-hash sentinel); the
  SpendGuard contract lives on its own sub-account,
  `guard.omniperps-swarm.testnet`.

---

## For the README (paste-ready)

> **NEAR layer — OmniPerps Swarm.** Live NEAR testnet integration with real
> on-chain proof: three swarm accounts were created and funded on testnet
> (`omniperps-swarm.testnet` + two agents, 10 NEAR each, tx hashes in
> `docs/NEAR_PROOF.md`), and all state is read via plain JSON-RPC in
> `src/near-proof.js` (zero dependencies). Using NEAR Chain Signatures'
> official epsilon derivation, the swarm master deterministically controls
> EVM address `0x28ece91f7e9506d4c6f6a8d36db270d4ec1a688d` (path `ethereum-1`) —
> a derivation the live testnet MPC contract (`v1.signer-prod.testnet`)
> confirms byte-for-byte, and for which a **real MPC signature was requested
> and verified** (ecrecover over the signed payload reproduces the address;
> `node scripts/mpc-proof.js`). The SpendGuard policy is also deployed as a
> real testnet contract (`guard.omniperps-swarm.testnet`) and exercised
> live (`node scripts/guard-proof.js`). Settlement is modelled as NEAR
> Intents `token_diff` intents produced by the swarm. Honest limits: no
> intent has been executed on Intents mainnet, and no EVM transaction has
> been broadcast from the derived address.
