// worker/dev.js
//
// `npm run dev` (in /worker): runs the Worker locally with `wrangler dev`,
// passing your Windows environment variables through as Worker variables.
// That's how the local Worker gets ANTHROPIC_API_KEY without the key ever
// being written to a file. (Wrangler only does this when there is no
// .dev.vars file.) The root `npm run dev` (scripts/dev.js) also uses this.
//
// Extra arguments pass through, e.g. `npm run dev -- --port 8788`.

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

// On Windows, wrangler can start a second Worker on a port that's already in
// use, and requests then go to whichever one answers. Refuse instead.
const portArg = process.argv.indexOf('--port');
const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
const free = await new Promise((resolve) => {
  const server = net.createServer();
  server.once('error', () => resolve(false));
  server.once('listening', () => server.close(() => resolve(true)));
  server.listen(port, '127.0.0.1');
});
if (!free) {
  console.error(`Port ${port} is already in use. Is the Worker already running in another terminal?`);
  process.exit(1);
}

const child = spawn('npx', ['wrangler', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true' },
});
child.on('exit', (code) => process.exit(code ?? 0));

// When this launcher stops, stop wrangler and the local server it starts
// (workerd) too, so nothing is left behind holding the port.
function stopWrangler() {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // With shell: true the child is a cmd.exe wrapper; /T stops everything under it.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}
process.on('exit', stopWrangler);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => {
    // Ctrl+C reaches wrangler too, and it shuts down cleanly by itself.
    // Force it only if it's still running after a few seconds.
    setTimeout(() => {
      stopWrangler();
      process.exit(130);
    }, 3000).unref();
  });
}
