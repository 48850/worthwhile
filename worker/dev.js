// worker/dev.js
//
// `npm run dev`: runs the Worker locally with `wrangler dev`, passing your
// Windows environment variables through as Worker variables. That's how the
// local Worker gets ANTHROPIC_API_KEY without the key ever being written to
// a file. (Wrangler only does this when there is no .dev.vars file.)
//
// Extra arguments pass through, e.g. `npm run dev -- --port 8788`.

import { spawn } from 'node:child_process';

const child = spawn('npx', ['wrangler', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true' },
});
child.on('exit', (code) => process.exit(code ?? 0));
