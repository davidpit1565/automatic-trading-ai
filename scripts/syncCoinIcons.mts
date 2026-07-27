/**
 * Copies the coin logos we can actually use into `public/coins/`.
 *
 * Source: the `cryptocurrency-icons` package (CC0-1.0, public domain), a
 * dev-only dependency — the SVGs it provides are committed, so the build and
 * the running app never depend on it. Real marks are used rather than
 * hand-drawn approximations of trademarked logos.
 *
 * Coverage is partial by nature: the set predates most recent listings, so it
 * covers the majors and the established assets and misses newer tokens. The UI
 * falls back to a generated letter tile, so a missing file is a normal case,
 * not an error.
 *
 * Re-run after Kraken lists new pairs:  npx tsx scripts/syncCoinIcons.mts
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KrakenPublicSource } from '../src/core/data/krakenPublic';

const SOURCE_DIR = 'node_modules/cryptocurrency-icons/svg/color';
const TARGET_DIR = 'public/coins';
const MANIFEST = 'src/ui/coinLogoManifest.ts';

async function main(): Promise<void> {
  if (!existsSync(SOURCE_DIR)) {
    console.error(`Missing ${SOURCE_DIR}. Run: npm install --save-dev cryptocurrency-icons`);
    process.exitCode = 1;
    return;
  }

  const instruments = await new KrakenPublicSource().getInstruments();
  if (!instruments.ok) {
    console.error(`Could not load instruments: ${instruments.error}`);
    process.exitCode = 1;
    return;
  }
  const bases = [...new Set(instruments.value.map((i) => i.base.toUpperCase()))].sort();

  // Rebuild the directory so assets Kraken has delisted do not linger.
  rmSync(TARGET_DIR, { recursive: true, force: true });
  mkdirSync(TARGET_DIR, { recursive: true });

  const available = new Set(readdirSync(SOURCE_DIR));
  const copied: string[] = [];
  for (const base of bases) {
    const file = `${base.toLowerCase()}.svg`;
    if (!available.has(file)) continue;
    copyFileSync(join(SOURCE_DIR, file), join(TARGET_DIR, file));
    copied.push(base);
  }

  // The app needs to know which files exist WITHOUT probing: emitting an <img>
  // for all 535 assets would fire ~444 doomed requests per list render.
  writeFileSync(
    MANIFEST,
    `/**\n` +
      ` * Assets with a real logo in \`public/coins/\`. GENERATED — do not edit by\n` +
      ` * hand; run \`npx tsx scripts/syncCoinIcons.mts\` to refresh.\n` +
      ` *\n` +
      ` * Exists so the UI knows which files are present without probing for them:\n` +
      ` * emitting an <img> for every asset would fire hundreds of failing requests\n` +
      ` * on each render. Anything not listed here renders a letter tile instead.\n` +
      ` */\n` +
      `export const COIN_LOGOS: ReadonlySet<string> = new Set([\n` +
      copied.map((base) => `  '${base}',`).join('\n') +
      `\n]);\n`,
  );

  const pct = Math.round((100 * copied.length) / bases.length);
  console.log(`Copied ${copied.length} of ${bases.length} assets (${pct}%) into ${TARGET_DIR}.`);
  console.log(`Wrote ${MANIFEST}.`);
  console.log('The rest fall back to generated letter tiles, by design.');
}

await main();
