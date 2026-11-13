'use strict';
/**
 * Capture REAL console screenshots for the README:
 *   docs/images/console-overview.png   — live position open in the console
 *   docs/images/stress-protection.png  — stress test with protection firing
 *   docs/images/kill-switch.png        — kill switch engaged, cycle blocked
 *   docs/images/replay-mode.png        — REPLAY banner + toggle state (bonus)
 * Starts its own server on PORT 4174 and drives the real page with
 * headless Chromium (puppeteer, tooling-only — not a repo dependency).
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 4174;
const BASE = `http://localhost:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function state() {
  const r = await fetch(`${BASE}/api/state`);
  return r.json();
}
async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await state().catch(() => null);
    if (s && fn(s)) return s;
    await sleep(1500);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

(async () => {
  const server = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
  server.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
  try {
    await waitFor(s => s.price != null, 30000, 'feed price');

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1050 });
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
    await sleep(3000);

    // 1) Overview — wait until the swarm holds an open position.
    await waitFor(s => s.engine.position != null, 120000, 'open position');
    await sleep(2500);
    await page.screenshot({ path: path.join(ROOT, 'docs/images/console-overview.png'), fullPage: true });
    console.log('captured console-overview.png');

    // 2) Stress — fire the labelled simulated stress, wait for protection in the log.
    await page.evaluate(() => document.getElementById('btnStress').click());
    await waitFor(s => s.swarm.log.some(l => /FORCE-(REDUCE|CLOSE)/.test(l.text)), 90000, 'protection event');
    await sleep(1500);
    await page.screenshot({ path: path.join(ROOT, 'docs/images/stress-protection.png'), fullPage: true });
    console.log('captured stress-protection.png');

    // 3) Kill switch — engage, attempt a cycle, capture banner + blocked log line.
    await page.evaluate(() => document.getElementById('btnKill').click());
    await sleep(800);
    await page.evaluate(() => document.getElementById('btnCycle').click());
    await waitFor(s => s.swarm.log.some(l => /kill switch/i.test(l.text) && /skipped|blocked|refused/i.test(l.text)), 20000, 'blocked cycle log line');
    await sleep(800);
    await page.screenshot({ path: path.join(ROOT, 'docs/images/kill-switch.png'), fullPage: true });
    console.log('captured kill-switch.png');

    // 4) Replay mode (bonus) — release the kill switch, toggle REPLAY on.
    await page.evaluate(() => document.getElementById('btnKill').click());
    await sleep(500);
    await page.evaluate(() => document.getElementById('btnReplay').click());
    await waitFor(s => s.feed && s.feed.mode === 'replay', 20000, 'replay mode');
    await sleep(2500);
    await page.screenshot({ path: path.join(ROOT, 'docs/images/replay-mode.png'), fullPage: true });
    console.log('captured replay-mode.png');

    await browser.close();
    console.log('ALL SCREENSHOTS CAPTURED');
  } finally {
    server.kill('SIGTERM');
  }
})().catch(e => { console.error('CAPTURE FAILED:', e.message); process.exit(1); });
