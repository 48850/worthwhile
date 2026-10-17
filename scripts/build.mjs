// scripts/build.mjs
//
// Builds both targets into /dist with esbuild:
//   dist/chrome/     the Chrome/Edge extension ("Load unpacked" this folder)
//   dist/ios/filter.js  one self-contained script for WKUserScript injection
//
//   npm run build          production build
//   npm run build:dev      development build (logs analytics events)
//   --local                use the local Worker (http://127.0.0.1:8787) instead
//                          of the deployed one: npm run build:local
//
// Every bundle is an IIFE: no modules at run time, nothing leaks into the
// page's globals. The iOS bundle must never mention chrome.*; the build
// fails if it does.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const dev = process.argv.includes('--dev');
const local = process.argv.includes('--local');

// The Worker the extension talks to (adapters/chrome/config.ts).
const DEPLOYED_API = 'https://worthwhile.worthwhile-worker.workers.dev';
const LOCAL_API = 'http://127.0.0.1:8787';
const apiBaseUrl = local ? LOCAL_API : DEPLOYED_API;

const common = {
  bundle: true,
  format: 'iife',
  target: ['chrome120', 'safari16'],
  define: { __DEV__: String(dev), __API_BASE_URL__: JSON.stringify(apiBaseUrl) },
  legalComments: 'none',
  logLevel: 'warning',
  minify: false, // readable bundles: easier to debug and to review
};

// ---------------------------------------------------------------------------
// dist/chrome
// ---------------------------------------------------------------------------

const chromeOut = path.join(DIST, 'chrome');
fs.rmSync(chromeOut, { recursive: true, force: true });
fs.mkdirSync(chromeOut, { recursive: true });

await esbuild.build({
  ...common,
  entryPoints: {
    content: 'adapters/chrome/content.ts', // content script (isolated world)
    page: 'adapters/chrome/page.ts', // content script in YouTube's page world
    background: 'adapters/chrome/background.ts', // service worker
    popup: 'adapters/chrome/ui/popup.ts',
    options: 'adapters/chrome/ui/options.ts',
  },
  absWorkingDir: ROOT,
  outdir: chromeOut,
});

for (const [from, to] of [
  ['adapters/chrome/manifest.json', 'manifest.json'],
  ['adapters/chrome/ui/popup.html', 'popup.html'],
  ['adapters/chrome/ui/options.html', 'options.html'],
  ['adapters/chrome/ui/ui.css', 'ui.css'],
  ['sites/youtube-desktop/styles.css', 'styles.css'],
]) {
  fs.copyFileSync(path.join(ROOT, from), path.join(chromeOut, to));
}
console.log(`Built dist/chrome${dev ? ' (development)' : ''}, talking to ${apiBaseUrl}.`);

// ---------------------------------------------------------------------------
// dist/ios/filter.js
// ---------------------------------------------------------------------------

const iosEntry = 'adapters/ios-webview/bootstrap.ts';
if (fs.existsSync(path.join(ROOT, iosEntry))) {
  const iosOut = path.join(DIST, 'ios');
  fs.rmSync(iosOut, { recursive: true, force: true });
  await esbuild.build({ ...common, entryPoints: [iosEntry], absWorkingDir: ROOT, outfile: path.join(iosOut, 'filter.js') });

  // The WebView has no chrome.* at all: any mention means Chrome-only code
  // slipped in. Optional chaining (chrome?.x) counts too.
  const bundle = fs.readFileSync(path.join(iosOut, 'filter.js'), 'utf8');
  const hits = bundle.split('\n').flatMap((line, i) => (/chrome\??\./.test(line) ? [`  line ${i + 1}: ${line.trim().slice(0, 120)}`] : []));
  if (hits.length) {
    console.error(`dist/ios/filter.js mentions "chrome." (${hits.length} line${hits.length === 1 ? '' : 's'}):\n${hits.join('\n')}`);
    process.exit(1);
  }
  console.log(`Built dist/ios/filter.js${dev ? ' (development)' : ''} (${Math.round(bundle.length / 1024)} KB, no "chrome.").`);
}
