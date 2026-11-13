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

const bundle = [
  '<script>',
  'window.__mods = {};',
  wrap('perps', 'src/perps.js'),
  wrap('policy', 'src/policy.js'),
  wrap('pricefeed', 'src/pricefeed.js'),
  wrap('agents', 'src/agents.js'),
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
