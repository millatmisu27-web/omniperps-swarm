'use strict';
/**
 * Builds demo-dist/index.html — a single self-contained page for
 * static hosting (GitHub Pages / Netlify / Vercel / any file host).
 * Bundles src/perps.js, src/policy.js, src/pricefeed.js, src/agents.js
 * UNMODIFIED (wrapped in a tiny module shim), the console CSS/HTML,
 * public/demo-glue.js and public/app.js (also unmodified).
 * Run: node scripts/build-demo.js
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

function guard(name, src) {
  if (src.includes('</script')) throw new Error(`${name} contains </script — cannot inline safely`);
  return src;
}

const wrap = (key, file) =>
  `window.__mods.${key} = (function(){ const module = { exports: {} }; const exports = module.exports;\n${guard(file, read(file))}\nreturn module.exports; })();`;

const html = read('public/index.html');
const css = read('public/style.css');
const glue = guard('demo-glue', read('public/demo-glue.js'));
const app = guard('app', read('public/app.js'));

// Trimmed REPLAY window for the hosted build: the 240 consecutive
// recorded candles with the widest high-low range (the full 721-candle
// recording lives in data/replay-btc.json for the server build).
function trimmedReplay() {
  const full = JSON.parse(read('data/replay-btc.json'));
  const W = 240;
  let best = 0, bestRange = -1;
  for (let i = 0; i + W <= full.candles.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let k = i; k < i + W; k++) { hi = Math.max(hi, full.candles[k].high); lo = Math.min(lo, full.candles[k].low); }
    if (hi - lo > bestRange) { bestRange = hi - lo; best = i; }
  }
  const candles = full.candles.slice(best, best + W);
  return {
    meta: {
      ...full.meta,
      candle_count: candles.length,
      window_start: new Date(candles[0].ts).toISOString(),
      window_end: new Date(candles[candles.length - 1].ts).toISOString(),
      note: 'Trimmed window of the full recording in data/replay-btc.json (widest-range 240 candles), bundled into the hosted demo. Recorded REAL market data.',
    },
    candles,
  };
}

let settlements = [];
try { settlements = JSON.parse(read('data/settlements.json')); if (!Array.isArray(settlements)) settlements = [settlements]; } catch (e) { /* none recorded yet */ }

const bundle = [
  '<script>',
  'window.__mods = {};',
  wrap('perps', 'src/perps.js'),
  wrap('policy', 'src/policy.js'),
  wrap('pricefeed', 'src/pricefeed.js'),
  wrap('replayfeed', 'src/replayfeed.js'),
  wrap('agents', 'src/agents.js'),
  `window.__replayData = ${guard('replay-data', JSON.stringify(trimmedReplay()))};`,
  `window.__settlements = ${guard('settlements', JSON.stringify(settlements))};`,
  glue,
  '</script>',
  '<script>',
  app,
  '</script>',
].join('\n');

// NOTE: replacer FUNCTIONS are required — the sources contain '$'
// sequences (e.g. '$' + fmt(...)) that String.replace would otherwise
// interpret as replacement patterns and corrupt the bundle.
let out = html
  .replace('<link rel="stylesheet" href="/style.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script src="/app.js"></script>', () => bundle)
  .replace('<title>OmniPerps Swarm — NEAR HACKATHON</title>', '<title>OmniPerps Swarm — LIVE HOSTED DEMO — NEAR HACKATHON</title>');

if (out.includes('src="/app.js"') || out.includes('href="/style.css"')) throw new Error('external references remain — build failed');

const dist = path.join(root, 'demo-dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), out);
console.log(`demo-dist/index.html written (${out.length} bytes)`);
