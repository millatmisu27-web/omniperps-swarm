'use strict';
/**
 * OmniPerps Swarm — dashboard server (zero-dependency Node http).
 * Run: npm start   (PORT env, default 4173)
 *
 * Live prices poll from public feeds (Kraken -> Coinbase -> CoinGecko).
 * The STRESS button applies a clearly-labelled SIMULATED price shock
 * on top of the live anchor so the Risk Agent's protection can be
 * demonstrated on demand; the shock state is always shown in the UI.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const { PerpEngine } = require('./src/perps');
const { SpendGuard } = require('./src/policy');
const { PriceFeed } = require('./src/pricefeed');
const { ReplayFeed } = require('./src/replayfeed');
const { Swarm } = require('./src/agents');
// Optional, env-flagged (OMNIPERPS_GUARD_CHAIN=1): logs one LIVE read of
// the deployed on-chain SpendGuard contract per decision cycle. Inert
// when the flag is unset; read-only and fail-safe when set.
const guardChain = require('./src/guard-chain');

const PORT = process.env.PORT || 4173;
const PUBLIC = path.join(__dirname, 'public');

let engine, guard, swarm, feed;
let shock = { active: false, direction: 0, stepsLeft: 0, stepPct: 0, offsetPct: 0 };
let lastLivePrice = null;

// --- Dual LIVE ⇄ REPLAY feed management (owner requirement: the demo
// must work online AND offline). LIVE is the default; REPLAY plays back
// recorded REAL Kraken candles (data/replay-btc.json) and is entered
// either manually (console toggle / POST /api/feed-mode) or AUTOMATICALLY
// after repeated live failures — always announced, never silent.
let feedMode = 'live';        // 'live' | 'replay'
let feedAutoSwitched = false; // true when replay was an automatic fallback
let liveFailures = 0;
let replayDataCache = null;

function loadReplayData() {
  if (!replayDataCache) {
    replayDataCache = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'replay-btc.json'), 'utf8'));
  }
  return replayDataCache;
}

function feedInfo() {
  return {
    mode: feedMode,
    autoSwitched: feedAutoSwitched,
    label: feedMode === 'replay' ? feed.label() : null,
    liveFailures,
  };
}

async function setFeedMode(mode, { auto = false } = {}) {
  feedMode = mode;
  feedAutoSwitched = auto;
  liveFailures = 0;
  feed = mode === 'replay' ? new ReplayFeed(loadReplayData()) : new PriceFeed();
  try { await feed.seedHistory(60); } catch (e) { /* surfaced in state */ }
  try {
    const pt = await feed.pollOnce();
    lastLivePrice = pt.price;
    applyMark();
    if (mode === 'replay') {
      swarm.say('signal', 'swarm', 'info', `${auto ? 'AUTO-FALLBACK: live feed unreachable — switched to' : 'Switched to'} ${feed.label()}. BTC $${pt.price}.`);
    } else {
      swarm.say('signal', 'swarm', 'info', `Live feed connected (${pt.source}) — BTC $${pt.price}. History seeded with ${feed.history.length} real points.`);
    }
  } catch (e) {
    swarm.say('signal', 'swarm', 'error', `Feed switch to ${mode} failed at first poll: ${e.message}`);
    if (mode === 'live' && !auto) { /* stay live; interval keeps retrying */ }
  }
}

function resetAll() {
  engine = new PerpEngine({ startingBalance: 100000 });
  guard = new SpendGuard();
  swarm = new Swarm({ engine, guard });
  shock = { active: false, direction: 0, stepsLeft: 0, stepPct: 0, offsetPct: 0 };
}
resetAll();
feed = new PriceFeed();

function effectivePrice() {
  if (lastLivePrice == null) return null;
  return Math.round(lastLivePrice * (1 + shock.offsetPct / 100) * 100) / 100;
}

function applyMark() {
  const p = effectivePrice();
  if (p == null) return;
  engine.setMarkPrice(p);
  swarm.onPrice(p);
}

async function bootFeed() {
  try { await feed.seedHistory(60); } catch (e) { /* logged in state */ }
  try {
    const pt = await feed.pollOnce();
    lastLivePrice = pt.price;
    applyMark();
    swarm.say('signal', 'swarm', 'info', `Live feed connected (${pt.source}) — BTC $${pt.price}. History seeded with ${feed.history.length} real points.`);
  } catch (e) {
    swarm.say('signal', 'swarm', 'error', `Live feed unreachable at boot: ${e.message}. AUTO-FALLBACK to REPLAY (recorded real prices) so the demo stays usable offline.`);
    await setFeedMode('replay', { auto: true });
  }
}

setInterval(async () => {
  try {
    const pt = await feed.pollOnce();
    lastLivePrice = pt.price;
    liveFailures = 0;
  } catch (e) {
    if (feedMode === 'live') {
      liveFailures++;
      if (liveFailures >= 2) {
        swarm.say('signal', 'swarm', 'error', `Live feed failed ${liveFailures} polls in a row (${e.message}). AUTO-FALLBACK to REPLAY (recorded real prices).`);
        await setFeedMode('replay', { auto: true });
      }
    }
    /* in replay mode a poll failure keeps the last price; error in state */
  }
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
  guardChain.logLiveGuardCheck(swarm, 'auto-cycle');
  swarm.runCycle(feed.history.concat([{ price: p }]), p);
}, 5000);

function loadSettlements() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'data', 'settlements.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) { return []; }
}

function state() {
  const p = effectivePrice();
  return {
    now: Date.now(),
    price: p,
    livePrice: lastLivePrice,
    priceSource: feed.lastSource,
    priceError: feed.lastError,
    feed: feedInfo(),
    settlements: loadSettlements(),
    history: feed.history.slice(-120).concat(p != null ? [{ ts: Date.now(), price: p, source: shock.offsetPct !== 0 ? 'live+stress-overlay' : (feed.lastSource || 'live') }] : []),
    shock: { ...shock, label: shock.offsetPct !== 0 ? `SIMULATED stress overlay ${shock.offsetPct.toFixed(1)}% on live price` : null },
    engine: engine.snapshot(),
    guard: guard.snapshot(),
    guardLog: guard.log.slice(-30),
    swarm: swarm.snapshot(),
  };
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/state') return sendJson(res, 200, state());
    if (url.pathname === '/api/near') {
      try {
        const near = require('./src/near-proof');
        if (typeof near.collectProof === 'function') {
          if (!global.__nearCache || Date.now() - global.__nearCache.at > 60000) {
            global.__nearCache = { at: Date.now(), data: await near.collectProof() };
          }
          return sendJson(res, 200, global.__nearCache.data);
        }
        return sendJson(res, 200, { status: 'module-present', exports: Object.keys(near) });
      } catch (e) {
        return sendJson(res, 200, { status: 'error', error: String(e.message || e) });
      }
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      await new Promise(r => req.on('end', r));
      const data = body ? JSON.parse(body) : {};
      const p = effectivePrice();
      if (url.pathname === '/api/cycle') {
        if (p == null) return sendJson(res, 400, { error: 'no live price yet' });
        guardChain.logLiveGuardCheck(swarm, 'api-cycle');
        return sendJson(res, 200, swarm.runCycle(feed.history.concat([{ price: p }]), p));
      }
      if (url.pathname === '/api/stress') {
        if (p == null) return sendJson(res, 400, { error: 'no live price yet' });
        const side = engine.position ? engine.position.side : 'long';
        const dir = side === 'long' ? -1 : 1; // adverse to the open position
        shock = { active: true, direction: dir, stepsLeft: 10, stepPct: 1.8, offsetPct: shock.offsetPct };
        swarm.say('operator', 'swarm', 'stress', `STRESS TEST started (SIMULATED): adverse move ${dir < 0 ? 'down' : 'up'} ~18% over ~30s against the ${side.toUpperCase()} position, on top of the live price.`);
        return sendJson(res, 200, { ok: true, shock });
      }
      if (url.pathname === '/api/recover') {
        shock.offsetPct = 0; shock.active = false; shock.stepsLeft = 0;
        swarm.say('operator', 'swarm', 'info', 'Stress overlay cleared — mark price back to the live anchor.');
        applyMark();
        return sendJson(res, 200, { ok: true });
      }
      if (url.pathname === '/api/kill') {
        swarm.setKill(!!data.on, 'operator-ui');
        return sendJson(res, 200, { ok: true, killSwitch: guard.killSwitch });
      }
      if (url.pathname === '/api/close') {
        if (p == null) return sendJson(res, 400, { error: 'no live price yet' });
        return sendJson(res, 200, { ok: true, result: swarm.closePosition(p, 'operator-ui') });
      }
      if (url.pathname === '/api/reset') { resetAll(); applyMark(); return sendJson(res, 200, { ok: true }); }
      if (url.pathname === '/api/feed-mode') {
        const mode = data.mode === 'replay' ? 'replay' : 'live';
        await setFeedMode(mode, { auto: false });
        return sendJson(res, 200, { ok: true, feed: feedInfo() });
      }
      return sendJson(res, 404, { error: 'unknown endpoint' });
    }
    // static
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    const fp = path.join(PUBLIC, path.normalize(file));
    if (!fp.startsWith(PUBLIC) || !fs.existsSync(fp)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  } catch (e) {
    sendJson(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, async () => {
  console.log(`OmniPerps Swarm console: http://localhost:${PORT}`);
  await bootFeed();
});
