// scripts/new-invite.js
//
// Makes an invite token for a tester and prints the command that registers
// it in D1. Only the token's SHA-256 is stored, so keep the printed token:
// it can't be recovered later (make a new one instead).
//
// Run from the project root:
//   node scripts/new-invite.js "tester 3"

import crypto from 'node:crypto';

// The label is just a note for you. Keep it simple so it's safe inside SQL.
const label = (process.argv[2] || '').replace(/[^\w .-]/g, '').slice(0, 40);
const token = crypto.randomBytes(18).toString('base64url'); // 24 characters
const hash = crypto.createHash('sha256').update(token).digest('hex');
const sql = `INSERT INTO invites (token_hash, label, created_at) VALUES ('${hash}', '${label}', unixepoch());`;

console.log(`Invite token${label ? ` for "${label}"` : ''} (give this to the tester):\n\n  ${token}\n`);
console.log('Register it by running ONE of these from the worker folder:\n');
console.log(`  local dev:  npx wrangler d1 execute worthwhile --local --command "${sql}"`);
console.log(`  deployed:   npx wrangler d1 execute worthwhile --remote --command "${sql}"`);
