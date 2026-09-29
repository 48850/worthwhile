// scripts/build.mjs
//
// Builds both targets into /dist:
//   dist/chrome/   the Chrome/Edge extension ("Load unpacked" this folder)
//   dist/ios/      filter.js for WKUserScript injection (added later)
//
//   npm run build          production build
//   npm run build:dev      development build (logs analytics events)
//
// Step 1 of the restructure: the extension is still the plain-JS /extension
// folder, copied as is, so dist/chrome behaves exactly like it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

fs.rmSync(path.join(DIST, 'chrome'), { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'extension'), path.join(DIST, 'chrome'), { recursive: true });
console.log('Built dist/chrome (copied from /extension).');
