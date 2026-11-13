'use strict';
/**
 * OmniPerps Swarm — OPTIONAL live link to the on-chain SpendGuard.
 *
 * Behind the env flag OMNIPERPS_GUARD_CHAIN=1, the server reads the LIVE
 * state of the deployed SpendGuard contract
 * (`guard.omniperps-swarm.testnet`, NEAR testnet) once per decision cycle
 * and writes the result into the swarm transcript. This is a read-only
 * view call: it never signs, never spends, and — by design — can never
 * block or break a cycle (all errors are swallowed after a short note
 * to the server console). With the flag unset, this module is inert and
 * the demo behaves exactly as before.
 */
const { rpc, TESTNET_RPC } = require('./near-proof');

const GUARD_CONTRACT = 'guard.omniperps-swarm.testnet';
const ENABLED = process.env.OMNIPERPS_GUARD_CHAIN === '1';

async function fetchGuardState() {
  const result = await rpc(TESTNET_RPC, 'query', {
    request_type: 'call_function', finality: 'final',
    account_id: GUARD_CONTRACT, method_name: 'get_state', args_base64: 'e30=', // "{}"
  });
  if (result.error) throw new Error(result.error);
  return JSON.parse(Buffer.from(result.result).toString('utf8'));
}

/**
 * Fire-and-forget: logs one live contract check into the swarm transcript.
 * Never throws; safe to call without awaiting.
 */
function logLiveGuardCheck(swarm, context) {
  if (!ENABLED) return;
  fetchGuardState()
    .then((s) => {
      swarm.say('risk', 'swarm', 'info',
        `On-chain SpendGuard [${context}]: LIVE testnet read of ${GUARD_CONTRACT} — killed=${s.killed}, checks_count=${s.checks_count}, caps: $${s.max_notional_per_order}/order, ${s.max_leverage}x, min liq distance ${s.min_liquidation_distance_pct}%, daily loss $${s.max_daily_realised_loss}.`);
    })
    .catch((e) => {
      // Deliberately console-only: the judged demo flow must not depend on
      // network state, and a failed read must not pollute the transcript.
      console.error(`[guard-chain] live read failed (${context}): ${String(e.message || e).slice(0, 120)}`);
    });
}

module.exports = { GUARD_CONTRACT, ENABLED, fetchGuardState, logLiveGuardCheck };
