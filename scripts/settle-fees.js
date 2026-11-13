'use strict';
/**
 * OmniPerps Swarm — on-chain fee settlement (Agent Economy proof).
 *
 * Runs one full headless swarm session (prices: REPLAY — recorded
 * real Kraken candles, so the session never depends on network luck),
 * reads the resulting FeeLedger balances, and pays each agent's
 * earnings from the swarm master as REAL NEAR testnet transfers at
 * the fixed conversion in src/settlement.js (1 ledger unit = 0.01
 * testnet NEAR; testnet NEAR has zero real-world value).
 *
 *   Signal    -> omniperps-agent1-7f3a.testnet   (real transfer)
 *   Risk      -> omniperps-agent2-7f3a.testnet   (real transfer)
 *   Execution -> acts under the master (the payer itself): its share
 *                is retained by the payer; no self-transfer is made.
 *
 * Results are appended to data/settlements.json (shown in the
 * console's NEAR panel with explorer links) and printed with the
 * annotated ledger. Needs the demo keys file OUTSIDE the repo:
 *   KEYS_FILE=/path/to/omniperps-testnet-keys.txt node scripts/settle-fees.js
 */
const fs = require('node:fs');
const path = require('node:path');
const { PerpEngine } = require('../src/perps');
const { SpendGuard } = require('../src/policy');
const { ReplayFeed } = require('../src/replayfeed');
const { Swarm } = require('../src/agents');
const { viewAccount } = require('../src/near-proof');
const { transferSigned } = require('../src/near-tx');
const { NEAR_PER_LEDGER_UNIT, MASTER, MAX_TOTAL_NEAR, planSettlement, totalTransferYocto } = require('../src/settlement');

const KEYS_FILE = process.env.KEYS_FILE || '/home/hatch/workspace/omniperps-testnet-keys.txt';
const SETTLEMENTS_FILE = path.join(__dirname, '..', 'data', 'settlements.json');
const YOCTO_PER_NEAR = 10n ** 24n;

function loadKeysFor(accountId) {
  const text = fs.readFileSync(KEYS_FILE, 'utf8');
  const idx = text.indexOf(accountId);
  if (idx < 0) throw new Error(`${accountId} not found in keys file`);
  const matches = [...text.slice(idx).matchAll(/ed25519:([1-9A-HJ-NP-Za-km-z]+)/g)].map(m => m[0]);
  if (matches.length < 2) throw new Error(`could not parse keys for ${accountId}`);
  return { publicKey: matches[0], secretKey: matches[1] };
}

/** One full session: open -> simulated stress ladder -> kill-switch check. Mirrors scripts/demo-cli.js. */
async function runSession() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'replay-btc.json'), 'utf8'));
  const feed = new ReplayFeed(data);
  await feed.seedHistory(60);
  const pt = await feed.pollOnce();
  const history = feed.history.map(h => ({ price: h.price }));

  const engine = new PerpEngine({ startingBalance: 100000 });
  const guard = new SpendGuard();
  const swarm = new Swarm({ engine, guard });
  swarm.protectionCooldownMs = 0;
  engine.setMarkPrice(pt.price);

  const res = swarm.runCycle(history, pt.price);
  if (!res.acted || !engine.position) throw new Error('settlement session: swarm did not open a position');
  const entry = engine.position.entryPrice;
  const side = engine.position.side;
  const adverse = side === 'long' ? -1 : 1;
  for (let step = 1; step <= 14 && engine.position; step++) {
    const p = Math.round(entry * (1 + adverse * step * 0.015) * 100) / 100;
    engine.setMarkPrice(p);
    swarm.onPrice(p);
  }
  if (engine.position) swarm.closePosition(engine.markPrice, 'settle-fees');
  if (engine.liquidations !== 0) throw new Error('settlement session: unexpected liquidation');
  return swarm;
}

async function main() {
  console.log('OmniPerps Swarm — fee settlement run (NEAR testnet)');
  console.log(`Conversion: 1 ledger unit = ${NEAR_PER_LEDGER_UNIT} testnet NEAR (testnet NEAR has zero real-world value)`);

  const swarm = await runSession();
  const balances = { ...swarm.ledger.balances };
  console.log('Session ledger balances:', JSON.stringify(balances));

  const plan = planSettlement(balances);
  const totalYocto = totalTransferYocto(plan);
  const totalNear = Number(totalYocto) / 1e24;
  console.log('Settlement plan:');
  for (const p of plan) {
    console.log(`  ${p.agent}: ${p.ledgerUnits} units -> ${p.amountNear} NEAR -> ${p.toAccount}${p.selfTransfer ? ' (payer itself — retained, no transfer)' : ''}`);
  }
  console.log(`  total to transfer: ${totalNear} NEAR (cap ${MAX_TOTAL_NEAR})`);
  if (totalYocto > BigInt(Math.round(MAX_TOTAL_NEAR * 1e6)) * (YOCTO_PER_NEAR / 1000000n)) {
    throw new Error(`planned total exceeds the ${MAX_TOTAL_NEAR} NEAR settlement cap — refusing`);
  }

  if (!fs.existsSync(KEYS_FILE)) {
    console.log(`\nKeys file not found (${KEYS_FILE}) — plan only, no transfers made. Set KEYS_FILE to settle for real.`);
    return;
  }
  const keys = loadKeysFor(MASTER);
  const before = await viewAccount(MASTER);
  console.log(`Master balance before: ${before.amount_near} NEAR`);
  if (BigInt(before.amount_yoctonear) < totalYocto + YOCTO_PER_NEAR / 100n) {
    throw new Error('master balance too low for this settlement (+0.01 NEAR gas headroom)');
  }

  const payments = [];
  for (const p of plan) {
    if (p.selfTransfer) {
      payments.push({ agent: p.agent, toAccount: p.toAccount, ledgerUnits: p.ledgerUnits, amountNear: p.amountNear, txHash: null, note: 'Execution acts under the master account (the payer). Its earnings are retained by the payer — no self-transfer is made.' });
      continue;
    }
    const { txHash, outcome } = await transferSigned({
      signerId: MASTER, secretKeyString: keys.secretKey, publicKeyString: keys.publicKey,
      receiverId: p.toAccount, amountYocto: p.amountYocto,
    });
    if (outcome.status && outcome.status.Failure) throw new Error(`transfer to ${p.toAccount} failed: ${JSON.stringify(outcome.status.Failure).slice(0, 300)}`);
    console.log(`  PAID ${p.agent}: ${p.amountNear} NEAR -> ${p.toAccount}  tx ${txHash}`);
    payments.push({ agent: p.agent, toAccount: p.toAccount, ledgerUnits: p.ledgerUnits, amountNear: p.amountNear, txHash });
  }

  const after = await viewAccount(MASTER);
  console.log(`Master balance after: ${after.amount_near} NEAR`);

  const record = {
    settledAt: new Date().toISOString(),
    network: 'NEAR testnet',
    payer: MASTER,
    nearPerLedgerUnit: NEAR_PER_LEDGER_UNIT,
    conversionNote: 'Ledger units are the swarm-internal fee accounting (shown as $ in the console). They are settled on NEAR testnet at the fixed stated rate of 0.01 testnet NEAR per unit. Testnet NEAR has zero real-world value; no mainnet funds are involved.',
    sessionSource: 'headless swarm session on REPLAY prices (recorded real Kraken candles, data/replay-btc.json): position opened by the swarm, protection ladder fired under the labelled simulated stress, 0 liquidations',
    ledgerBalances: balances,
    payments,
    totalTransferredNear: (Number(totalYocto) / 1e24).toFixed(4),
    masterBalanceBefore: before.amount_near,
    masterBalanceAfter: after.amount_near,
  };

  let runs = [];
  try { runs = JSON.parse(fs.readFileSync(SETTLEMENTS_FILE, 'utf8')); if (!Array.isArray(runs)) runs = [runs]; } catch (e) { /* first run */ }
  runs.push(record);
  fs.writeFileSync(SETTLEMENTS_FILE, JSON.stringify(runs, null, 2));
  console.log(`\nRecorded in data/settlements.json (run #${runs.length}).`);

  console.log('\nLEDGER (annotated with settlement):');
  const txByAgent = Object.fromEntries(payments.map(p => [p.agent, p.txHash]));
  for (const e of swarm.ledger.entries) {
    const mark = txByAgent[e.to] ? `settled: ${txByAgent[e.to]}` : (e.to === 'execution' ? 'settled: retained by payer (master account)' : '');
    console.log(`  protocol-fee-pool -> ${e.to} $${e.amount.toFixed(2)} — ${e.reason}${mark ? `  [${mark}]` : ''}`);
  }
  console.log('\n*** FEE SETTLEMENT COMPLETE — real testnet transfers, hashes above ***');
}

main().catch(e => { console.error(e); process.exit(1); });
