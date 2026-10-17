// scripts/check-boundaries.mjs
//
// Fails (exit 1) if code in /core, /sites or /contracts talks to a host
// directly. Those folders must run unchanged in the Chrome extension and in
// the iOS WebView, so host APIs are only reached through the interfaces in
// core/interfaces.ts, implemented in /adapters.
//   node scripts/check-boundaries.mjs      (also run by `npm run build`)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FOLDERS = ['core', 'sites', 'contracts'];
const FORBIDDEN = [
  { pattern: /\bchrome\s*\.\s*[a-z]/, what: 'chrome.* (use the Storage/Messaging interfaces)' },
  { pattern: /\bwebkit\s*\.\s*messageHandlers/, what: 'window.webkit.messageHandlers (iOS adapter only)' },
  { pattern: /__WORTHWHILE_CONFIG__/, what: '__WORTHWHILE_CONFIG__ (iOS adapter only)' },
];

// The source with comments blanked out (comments may mention these APIs),
// keeping line breaks so line numbers stay right.
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, ' '));
}

const problems = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(ts|js|mjs)$/.test(entry.name)) {
      codeOnly(fs.readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((code, i) => {
          for (const { pattern, what } of FORBIDDEN) {
            if (pattern.test(code)) problems.push(`${path.relative(ROOT, file)}:${i + 1}: ${what}`);
          }
        });
    }
  }
}
for (const folder of FOLDERS) walk(path.join(ROOT, folder));

if (problems.length) {
  console.error('Boundary check failed: host APIs used outside /adapters:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`Boundary check passed (${FOLDERS.join(', ')}).`);
