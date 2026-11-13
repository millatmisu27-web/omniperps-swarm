'use strict';
const $ = id => document.getElementById(id);
const fmt = n => n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const time = ts => new Date(ts).toLocaleTimeString();

async function post(path, data = {}) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  return r.json();
}

function drawChart(history) {
  const cv = $('chart'), ctx = cv.getContext('2d');
  const W = cv.width = cv.clientWidth * 2, H = cv.height = 360;
  ctx.clearRect(0, 0, W, H);
  if (!history || history.length < 2) return;
  const prices = history.map(h => h.price);
  const min = Math.min(...prices), max = Math.max(...prices), pad = (max - min) * 0.1 || 1;
  const x = i => i / (prices.length - 1) * (W - 20) + 10;
  const y = p => H - 20 - (p - min + pad) / (max - min + 2 * pad) * (H - 40);
  ctx.beginPath();
  prices.forEach((p, i) => i ? ctx.lineTo(x(i), y(p)) : ctx.moveTo(x(i), y(p)));
  ctx.strokeStyle = '#00ec97'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = '#8b93a7'; ctx.font = '22px system-ui';
  ctx.fillText('$' + fmt(max), 12, 30);
  ctx.fillText('$' + fmt(min), 12, H - 12);
}

async function refresh() {
  let s;
  try { s = await (await fetch('/api/state')).json(); } catch (e) { return; }
  const feedMode = s.feed ? s.feed.mode : 'live';
  const inReplay = feedMode === 'replay';
  $('price').textContent = s.price != null ? '$' + fmt(s.price) : '—';
  $('priceMeta').textContent = s.livePrice != null
    ? inReplay
      ? `${s.feed.label || 'REPLAY — recorded real prices'}${s.shock.offsetPct ? ` · stress overlay ${s.shock.offsetPct.toFixed(1)}% (SIMULATED)` : ''}`
      : `live anchor $${fmt(s.livePrice)} via ${s.priceSource || 'feed'}${s.shock.offsetPct ? ` · stress overlay ${s.shock.offsetPct.toFixed(1)}% (SIMULATED)` : ''}`
    : `feed error: ${s.priceError || 'connecting…'}`;
  $('chartTitle').textContent = inReplay ? 'Price — REPLAY of recorded real feed' : 'Live price (real feed)';
  $('histNote').textContent = s.history.length ? `${s.history.length} real points` : '';
  $('replayBanner').classList.toggle('hidden', !inReplay);
  if (inReplay) $('replayBanner').textContent = `↺ ${s.feed.label || 'REPLAY — recorded real prices'}${s.feed.autoSwitched ? ' · entered automatically: live feed unreachable' : ' · selected manually'} — the prices are real recorded market data, not live and not simulated. Switch back with the LIVE button.`;
  $('btnLive').disabled = !inReplay;
  $('btnReplay').disabled = inReplay;
  drawChart(s.history);

  $('shockBanner').classList.toggle('hidden', !s.shock.label);
  if (s.shock.label) $('shockBanner').textContent = '⚠ ' + s.shock.label + ' — applied for the protection demo; the live anchor underneath is real.';
  $('killBanner').classList.toggle('hidden', !s.guard.killSwitch);
  $('btnKill').textContent = s.guard.killSwitch ? 'Release kill switch' : '⛔ KILL SWITCH';

  const e = s.engine;
  if (e.position) {
    const p = e.position;
    $('position').textContent =
      `${p.side.toUpperCase()} ${p.sizeBtc} BTC · entry $${fmt(p.entryPrice)} · mark $${fmt(e.markPrice)}\n` +
      `leverage ${p.leverage}x · margin $${fmt(p.margin)} · liq @ $${fmt(p.liquidationPrice)}\n` +
      `unrealised PnL: $${fmt(e.unrealisedPnl)}`;
    const d = e.liquidationDistancePct ?? 0;
    $('liqGauge').style.width = Math.min(100, d * 3) + '%';
    $('liqGauge').style.background = d < 7 ? '#ff5d73' : d < 12 ? '#ffb454' : '#00ec97';
    $('liqText').textContent = `${d.toFixed(2)}% away from liquidation (protection < 12%, force-close < 7%)`;
  } else {
    $('position').textContent = 'No open position';
    $('liqGauge').style.width = '0%';
    $('liqText').textContent = '—';
  }
  $('account').textContent =
    `wallet (paper) $${fmt(e.walletBalance)} · equity $${fmt(e.equity)} · realised PnL $${fmt(e.realisedPnlTotal)} · fees $${fmt(e.feesPaidTotal)} · liquidations ${e.liquidations}`;

  $('agents').innerHTML = s.swarm.agents.map(a =>
    `<div class="agent"><b>${a.role}</b> — <span class="st">${a.status}</span><br>` +
    `<span class="st">${a.nearAccount}</span> · earned (ledger) $${fmt(a.earned)}</div>`).join('');
  $('ledger').innerHTML = s.swarm.ledger.slice().reverse().map(l =>
    `<div><span class="t">${time(l.ts)}</span> ${l.from} → <b>${l.to}</b> $${fmt(l.amount)} — ${l.reason}</div>`).join('') || 'no entries yet';

  const g = s.guard;
  $('guard').textContent =
    `per-order notional cap $${fmt(g.limits.maxNotionalPerOrder)} · leverage ceiling ${g.limits.maxLeverage}x · min liq distance ${g.limits.minLiquidationDistancePct}% · daily loss limit $${fmt(g.limits.maxDailyRealisedLoss)}\n` +
    `kill switch: ${g.killSwitch ? 'ENGAGED by ' + g.killedBy : 'off'} · checks logged ${g.checksLogged} · vetoes ${g.vetoes}`;
  $('guardLog').innerHTML = s.guardLog.slice().reverse().map(l =>
    `<div><span class="t">${time(l.ts)}</span> [${l.agent}] ${l.verdict}${l.reasons && l.reasons.length ? ' — ' + l.reasons.join('; ') : ''}</div>`).join('') || 'no checks yet';

  $('swarmLog').innerHTML = s.swarm.log.slice().reverse().map(l =>
    `<div><span class="t">${time(l.ts)}</span> <b>${l.from}</b> → ${l.to} [${l.type}] ${l.text}</div>`).join('') || 'no decisions yet';

  $('intents').innerHTML = s.swarm.intents.slice().reverse().map(i =>
    `<div><span class="t">${i.ts}</span> settlement intent: ${i.side} ${i.diff['perp:btc-usdt']} BTC @ $${fmt(i.reference_price_usd)} (${i.intent_type})</div>`).join('');

  const runs = s.settlements || [];
  if (runs.length) {
    const run = runs[runs.length - 1];
    $('settlements').innerHTML =
      `<div>Settlement run ${run.settledAt} — ledger earnings paid on NEAR testnet at ${run.nearPerLedgerUnit} NEAR per ledger unit (testnet NEAR, no real-world value). Ledger at settlement: ` +
      Object.entries(run.ledgerBalances).map(([a, v]) => `${a} $${fmt(v)}`).join(' · ') + `</div>` +
      run.payments.map(p => p.txHash
        ? `<div><span class="t">${p.agent}</span> → ${p.toAccount} — ${p.amountNear} NEAR · <a href="https://testnet.nearblocks.io/txns/${p.txHash}" target="_blank" rel="noopener">tx ${p.txHash.slice(0, 12)}…</a> (settled)</div>`
        : `<div><span class="t">${p.agent}</span> → ${p.toAccount} — ${p.note || 'not transferred'}</div>`).join('');
  }
}

async function refreshNear() {
  try {
    const n = await (await fetch('/api/near')).json();
    $('near').textContent = JSON.stringify(n, null, 1).slice(0, 1800);
  } catch (e) { $('near').textContent = 'near proof unavailable: ' + e.message; }
}

$('btnLive').onclick = async () => { await post('/api/feed-mode', { mode: 'live' }); refresh(); };
$('btnReplay').onclick = async () => { await post('/api/feed-mode', { mode: 'replay' }); refresh(); };
$('btnCycle').onclick = async () => { await post('/api/cycle'); refresh(); };
$('btnStress').onclick = async () => { await post('/api/stress'); refresh(); };
$('btnRecover').onclick = async () => { await post('/api/recover'); refresh(); };
$('btnClose').onclick = async () => { await post('/api/close'); refresh(); };
$('btnReset').onclick = async () => { await post('/api/reset'); refresh(); };
$('btnKill').onclick = async () => {
  const s = await (await fetch('/api/state')).json();
  await post('/api/kill', { on: !s.guard.killSwitch });
  refresh();
};

refresh(); refreshNear();
setInterval(refresh, 2000);
setInterval(refreshNear, 30000);
