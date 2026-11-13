'use strict';
/* Verify the hosted demo-dist page: glue boots, dual feed works, settlements render. */
const path = require('node:path');
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, '..', '..', 'demo-dist', 'index.html'), { waitUntil: 'load' });
  await sleep(6000);
  const s1 = await page.evaluate(async () => {
    const r = await fetch('/api/state'); const s = await r.json();
    return { mode: s.feed && s.feed.mode, source: s.priceSource, price: s.price, settlements: (s.settlements || []).length, banner: !!document.getElementById('replayBanner') };
  });
  console.log('hosted initial state:', JSON.stringify(s1));
  await page.evaluate(() => document.getElementById('btnReplay').click());
  await sleep(4000);
  const s2 = await page.evaluate(async () => {
    const r = await fetch('/api/state'); const s = await r.json();
    const b = document.getElementById('replayBanner');
    return { mode: s.feed.mode, auto: s.feed.autoSwitched, source: s.priceSource, bannerVisible: !b.classList.contains('hidden'), bannerText: b.textContent.slice(0, 80), settlementsHtml: document.getElementById('settlements').textContent.slice(0, 90) };
  });
  console.log('hosted after REPLAY toggle:', JSON.stringify(s2, null, 1));
  await page.evaluate(() => document.getElementById('btnLive').click());
  await sleep(5000);
  const s3 = await page.evaluate(async () => { const r = await fetch('/api/state'); const s = await r.json(); return { mode: s.feed.mode, source: s.priceSource }; });
  console.log('hosted back to LIVE:', JSON.stringify(s3));
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
  if (s2.mode !== 'replay' || !s2.bannerVisible || s3.mode !== 'live') { console.error('HOSTED VERIFY FAILED'); process.exit(1); }
  console.log('HOSTED DEMO VERIFIED');
})().catch(e => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
