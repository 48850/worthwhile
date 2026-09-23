// scripts/dev.js
//
// `npm run dev` from the project root: everything needed to test the
// extension locally, in one command.
//   1. Installs the Worker's dependencies if they're missing.
//   2. Makes sure the local D1 database has its tables.
//   3. Makes sure a local invite token exists: creates one the first time,
//      reuses it after that. Registers it in the local D1, prints it and
//      copies it to the clipboard.
//   4. Starts the local Worker on http://127.0.0.1:8787 and leaves it
//      running. Ctrl+C stops it.
//
// The Worker only stores token hashes, so the local token itself is saved in
// worker/.wrangler/ (gitignored), next to the local database. It only works
// against that local database. Deleting worker/.wrangler resets both.

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = path.join(ROOT, 'worker');
const STATE = path.join(WORKER, '.wrangler');
const TOKEN_FILE = path.join(STATE, 'local-invite-token.txt');
const PORT = 8787; // must match WORKER_URL in extension/background.js

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});

async function main() {
  if (!(await portIsFree(PORT))) {
    throw new Error(`Port ${PORT} is already in use. Is the Worker already running in another terminal?`);
  }
  if (fs.existsSync(path.join(WORKER, '.dev.vars'))) {
    console.warn('Warning: worker/.dev.vars exists, so Windows environment variables (your API key) will NOT reach the Worker. Delete it unless you meant that.');
  }

  if (!fs.existsSync(path.join(WORKER, 'node_modules'))) {
    step('Installing the Worker\'s dependencies (first run only)');
    run('npm', ['install', '--no-fund', '--no-audit']);
  }

  // The API keys are Windows user environment variables. A terminal opened
  // before they were set can't see them, so fall back to reading them directly.
  const env = { ...process.env };
  for (const name of ['ANTHROPIC_API_KEY', 'YOUTUBE_API_KEY']) {
    if (!env[name]) env[name] = readWindowsUserEnv(name);
  }
  if (!env.ANTHROPIC_API_KEY) {
    console.warn('Warning: ANTHROPIC_API_KEY is not set. The Worker will start, but nothing can be scored, so every video will be shown.');
  }
  if (!env.YOUTUBE_API_KEY) {
    console.warn('Note: YOUTUBE_API_KEY is not set, so sourcing is off (the grid shows only your own feed).');
  }

  step('Preparing the local database and invite token');
  const token = loadOrCreateToken();
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  // Schema (safe to re-run) plus the token, in one wrangler call.
  // INSERT OR IGNORE: registers the token if the database is new, else does nothing.
  const sql =
    fs.readFileSync(path.join(WORKER, 'schema.sql'), 'utf8') +
    `\nINSERT OR IGNORE INTO invites (token_hash, label, created_at) VALUES ('${hash}', 'local dev', unixepoch());\n`;
  fs.writeFileSync(path.join(STATE, 'dev-setup.sql'), sql);
  run('npx', ['wrangler', 'd1', 'execute', 'worthwhile', '--local', '--file=.wrangler/dev-setup.sql'], { quiet: true });

  const copied = copyToClipboard(token);
  printToken(token, copied);

  step(`Starting the local Worker on http://127.0.0.1:${PORT} (Ctrl+C to stop)`);
  // worker/dev.js runs `wrangler dev` with environment variables passed
  // through. Its output is echoed here, and the token is repeated once the
  // Worker is ready, since wrangler's start-up output is long.
  const child = spawn('node', ['dev.js', '--port', String(PORT)], {
    cwd: WORKER,
    env,
    stdio: ['inherit', 'pipe', 'inherit'],
  });
  let announced = false;
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    if (!announced && chunk.toString().includes('Ready on')) {
      announced = true;
      printToken(token, copied, true);
    }
  });
  child.on('exit', (code) => process.exit(code ?? 0));

  // If this script is stopped, stop the Worker too (worker/dev.js and
  // everything it started), so nothing is left holding the port.
  const stopWorker = () => {
    if (child.exitCode !== null) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  };
  process.on('exit', stopWorker);
  process.on('SIGINT', () => {
    // Ctrl+C reaches the Worker too and it stops by itself; force it only if it hasn't.
    setTimeout(() => {
      stopWorker();
      process.exit(130);
    }, 4000).unref();
  });
}

// The saved local token, or a new one (saved for next time).
function loadOrCreateToken() {
  fs.mkdirSync(STATE, { recursive: true });
  if (fs.existsSync(TOKEN_FILE)) {
    const saved = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (/^[A-Za-z0-9_-]{24}$/.test(saved)) return saved;
  }
  const token = crypto.randomBytes(18).toString('base64url'); // 24 characters
  fs.writeFileSync(TOKEN_FILE, token);
  return token;
}

function printToken(token, copied, ready = false) {
  const line = '-'.repeat(60);
  console.log(`\n${line}`);
  if (ready) console.log(`Worker ready at http://127.0.0.1:${PORT}`);
  console.log(`Local invite token: ${token}${copied ? '   (copied to your clipboard)' : ''}`);
  console.log('Paste it into the extension\'s settings page (right-click the toolbar icon > Options).');
  console.log(`${line}\n`);
}

// Runs a command in the worker folder and stops with its output if it fails.
function run(command, args, { quiet = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: WORKER,
    shell: true, // npm and npx are .cmd files on Windows
    stdio: quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    if (quiet) console.error(result.stdout, result.stderr);
    throw new Error(`"${command} ${args.join(' ')}" failed`);
  }
}

function step(text) {
  console.log(`\n> ${text}`);
}

function readWindowsUserEnv(name) {
  if (process.platform !== 'win32') return '';
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${name}', 'User')`],
    { encoding: 'utf8' },
  );
  return (result.stdout || '').trim();
}

// Returns true if the text made it onto the clipboard.
function copyToClipboard(text) {
  const command = { win32: 'clip', darwin: 'pbcopy' }[process.platform];
  if (!command) return false;
  const result = spawnSync(command, [], { input: text });
  return result.status === 0;
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}
