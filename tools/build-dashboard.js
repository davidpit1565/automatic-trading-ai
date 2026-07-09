/*
 * Build dashboard/index.html from dashboard/template.html by injecting:
 *   - src/indicators.js  (verbatim, at /*__INDICATORS__* /)
 *   - src/strategy.js    (verbatim, at /*__STRATEGY__* /)
 *   - data/dataset.json  (at /*__DATASET__* /)
 * Then verifies the injected engine code is byte-identical to the tested
 * source files. Exits non-zero on any failure.
 * Run: node tools/build-dashboard.js
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const template = read('dashboard/template.html');
const indicators = read('src/indicators.js');
const strategy = read('src/strategy.js');
const dataset = read('data/dataset.json');

for (const marker of ['/*__INDICATORS__*/', '/*__STRATEGY__*/', '/*__DATASET__*/']) {
  const n = template.split(marker).length - 1;
  if (n !== 1) { console.error(`FAIL: marker ${marker} appears ${n} times`); process.exit(1); }
}

const BEGIN = (n) => `/*ENGINE:${n}:BEGIN*/\n`;
const END = (n) => `\n/*ENGINE:${n}:END*/`;
const html = template
  .replace('/*__INDICATORS__*/', BEGIN('indicators') + indicators + END('indicators'))
  .replace('/*__STRATEGY__*/', BEGIN('strategy') + strategy + END('strategy'))
  .replace('/*__DATASET__*/', dataset);

const outPath = path.join(root, 'dashboard', 'index.html');
fs.writeFileSync(outPath, html);

// Verify: extract engines back out of the built file and byte-compare.
function extract(built, name) {
  const b = built.indexOf(BEGIN(name)), e = built.indexOf(END(name));
  if (b === -1 || e === -1) return null;
  return built.slice(b + BEGIN(name).length, e);
}
const built = fs.readFileSync(outPath, 'utf8');
let ok = true;
if (extract(built, 'indicators') !== indicators) { console.error('FAIL: indicators drifted'); ok = false; }
if (extract(built, 'strategy') !== strategy) { console.error('FAIL: strategy drifted'); ok = false; }
if (!built.includes('"generatedAt"')) { console.error('FAIL: dataset not embedded'); ok = false; }
if (!ok) process.exit(1);
console.log(`OK: built dashboard/index.html (${(built.length / 1024).toFixed(0)} KB); embedded engines byte-identical to tested source.`);
