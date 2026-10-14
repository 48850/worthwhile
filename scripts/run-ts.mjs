// scripts/run-ts.mjs
//
// Runs a TypeScript script with Node: bundles it with esbuild (the same
// way the extension is built, so it can import core/, contracts/ and
// shared/), then runs the bundle with the remaining arguments.
//   node scripts/run-ts.mjs scripts/eval.ts --model haiku-5.5

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [entry, ...args] = process.argv.slice(2);
if (!entry) {
  console.error('Usage: node scripts/run-ts.mjs <script.ts> [args...]');
  process.exit(1);
}

const outfile = path.join(ROOT, 'node_modules', '.cache', 'worthwhile', `${path.basename(entry, '.ts')}.mjs`);
await esbuild.build({
  entryPoints: [path.resolve(entry)],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external', // npm packages load from node_modules as usual
  define: { __DEV__: 'false' },
  outfile,
  logLevel: 'warning',
});
process.argv = [process.argv[0], path.resolve(entry), ...args];
await import(pathToFileURL(outfile).href);
