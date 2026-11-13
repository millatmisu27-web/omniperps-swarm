'use strict';
/**
 * HOSTED DEMO MODE glue.
 *
 * This page is the static-host build of the OmniPerps console. There is
 * no server: the REAL PerpEngine, SpendGuard and Swarm modules run in
 * your browser (bundled unmodified from src/), prices come from the
 * same live public feeds, and settlement is paper — exactly like the
 * local full stack. The only difference: /api/near performs a live
 * NEAR testnet RPC status read from the browser instead of the
 * server-side proof module (see docs/NEAR_PROOF.md in the repo).
 *
 * The glue installs a fetch() shim for the console's /api/* calls so
 * public/app.js runs unmodified.
 */
(function () {
  const { PerpEngine } = window.__mods.perps;
  const { SpendGuard } = window.__mods.policy;
  const { PriceFeed } = window.__mods.pricefeed;
  const { Swarm } = window.__mods.agents;

  let engine, guard, swarm, feed;
  let shock = { active: false, direction: 0, stepsLeft: 0, stepPct: 0, offsetPct: 0 };
  let lastLivePrice = null;

  function resetAll() {
    engine = new PerpEngine({ startingBalance: 100000 });
    guard = new SpendGuard();
    swarm = new Swarm({ engine, guard });
    shock = { active: false, direction: 0, stepsLeft: 0, stepPct: 0, offsetPct: 0 };
  }
  resetAll();
  feed = new PriceFeed();

  const effectivePrice = () => lastLivePrice == null ? null
    : Math.round(lastLivePrice * (1 + shock.offsetPct / 100) * 100) / 100;

  function applyMark() {
    const p = effectivePrice();
    if (p == null) return;
    engine.setMarkPrice(p);
    swarm.onPrice(p);
  }

  async function boot() {
    try { await feed.seedHistory(60); } catch (e) { /* visible in state */ }
    try {
      const pt = await feed.pollOnce();
      lastLivePrice = pt.price;
      applyMark();
      swarm.say('signal', 'swarm', 'info', `HOSTED DEMO MODE: live feed connected (${pt.source}) — BTC $${pt.price}. Engine + swarm are running in your browser; settlement is paper.`);
    } catch (e) {
      swarm.say('signal', 'swarm', 'error', `Live feed unreachable from this browser: ${e.message}. Will keep retrying.`);
    }
  }

  setInterval(async () => {
    try { const pt = await feed.pollOnce(); lastLivePrice = pt.price; } catch (e) { /* keep last */ }
    if (shock.active && shock.stepsLeft > 0) {
      shock.offsetPct += shock.direction * shock.stepPct;
      shock.stepsLeft -= 1;
      if (shock.stepsLeft <= 0) { shock.active = false; swarm.say('risk', 'swarm', 'info', `Stress shock finished at ${shock.offsetPct.toFixed(1)}% vs live anchor (SIMULATED overlay).`); }
    }
    applyMark();
  }, 3000);

  setInterval(() => {
    if (!swarm.autoTrade || guard.killSwitch || engine.position) return;
    if (Date.now() - swarm.lastCycleAt < swarm.cycleCooldownMs) return;
    const p = effectivePrice();
    if (p == null) return;
    swarm.runCycle(feed.history.concat([{ price: p }]), p);
  }, 5000);

  function state() {
    const p = effectivePrice();
    return {
      now: Date.now(), price: p, livePrice: lastLivePrice,
      priceSource: feed.lastSource, priceError: feed.lastError,
      history: feed.history.slice(-120).concat(p != null ? [{ ts: Date.now(), price: p, source: shock.offsetPct !== 0 ? 'live+stress-overlay' : (feed.lastSource || 'live') }] : []),
      shock: { ...shock, label: shock.offsetPct !== 0 ? `SIMULATED stress overlay ${shock.offsetPct.toFixed(1)}% on live price` : null },
      engine: engine.snapshot(), guard: guard.snapshot(), guardLog: guard.log.slice(-30), swarm: swarm.snapshot(),
    };
  }

  async function nearDemo() {
    try {
      const r = await fetch('https://rpc.testnet.near.org', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'demo', method: 'status', params: [] }),
      });
      const j = await r.json();
      return {
        mode: 'hosted-demo (browser-direct RPC read)',
        testnet_chain_id: j.result.chain_id,
        latest_block_height: j.result.sync_info.latest_block_height,
        latest_block_hash: j.result.sync_info.latest_block_hash,
        note: 'Live read from this browser just now. Full proof set: docs/NEAR_PROOF.md in the repo.',
      };
    } catch (e) {
      return { mode: 'hosted-demo', error: 'NEAR RPC read failed from this browser: ' + e.message, note: 'See docs/NEAR_PROOF.md in the repo for captured proof.' };
    }
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async function (url, opts = {}) {
    const u = String(url);
    if (!u.startsWith('/api/')) return realFetch(url, opts);
    const json = obj => new Response(JSON.stringify(obj), { headers: { 'content-type': 'application/json' } });
    const data = opts.body ? JSON.parse(opts.body) : {};
    const p = effectivePrice();
    if (u === '/api/state') return json(state());
    if (u === '/api/near') return json(await nearDemo());
    if (u === '/api/cycle') return p == null ? json({ error: 'no live price yet' }) : json(swarm.runCycle(feed.history.concat([{ price: p }]), p));
    if (u === '/api/stress') {
      const side = engine.position ? engine.position.side : 'long';
      const dir = side === 'long' ? -1 : 1;
      shock = { active: true, direction: dir, stepsLeft: 10, stepPct: 1.8, offsetPct: shock.offsetPct };
      swarm.say('operator', 'swarm', 'stress', `STRESS TEST started (SIMULATED): adverse move ${dir < 0 ? 'down' : 'up'} ~18% over ~30s against the ${side.toUpperCase()} position, on top of the live price.`);
      return json({ ok: true, shock });
    }
    if (u === '/api/recover') { shock.offsetPct = 0; shock.active = false; shock.stepsLeft = 0; swarm.say('operator', 'swarm', 'info', 'Stress overlay cleared — mark price back to the live anchor.'); applyMark(); return json({ ok: true }); }
    if (u === '/api/kill') { swarm.setKill(!!data.on, 'operator-ui'); return json({ ok: true, killSwitch: guard.killSwitch }); }
    if (u === '/api/close') return p == null ? json({ error: 'no live price yet' }) : json({ ok: true, result: swarm.closePosition(p, 'operator-ui') });
    if (u === '/api/reset') { resetAll(); applyMark(); return json({ ok: true }); }
    return json({ error: 'unknown endpoint' });
  };

  // Visible demo-mode banner (honesty in the UI, per build rules).
  const banner = document.createElement('div');
  banner.className = 'banner';
  banner.textContent = 'HOSTED DEMO MODE — the full engine + agent swarm run in your browser on live prices; settlement is paper. For the server build, judges run: npm start (from the public repo).';
  document.body.insertBefore(banner, document.body.children[1] || null);

  boot();
})();
