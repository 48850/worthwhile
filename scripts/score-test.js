// scripts/score-test.js
//
// M1 scoring test. Scores every row of a labelled CSV with the shared
// prompt (shared/prompt.js), compares the model's verdict with yours, and
// prints each disagreement plus the overall agreement %.
//
// Run from the project root:
//   npm run score-test                              score scripts/titles.csv
//   npm run score-test -- scripts/holdout.csv       score another file
//   npm run score-test -- --dry-run [file.csv]      print the prompt for the first batch, no API call
//
// Inputs:
//   .env                   ANTHROPIC_API_KEY=...        (gitignored)
//   scripts/profile.json   rubric, interests, strictness (same shape the options page saves)
//   the CSV                columns: title, channel, my_verdict (show|hide)
//
// titles.csv is the set you tune the rubric against. holdout.csv is a
// separate set you never tune against: its score is the honest estimate.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { BATCH_SIZE, DEFAULT_STRICTNESS, MODEL, buildRequest, parseScores, verdictFor } from '../shared/prompt.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const TARGET_PERCENT = 85;

// Haiku 4.5 list price in USD per million tokens (Sept 2026).
// Only used for the cost estimate at the end; update if pricing changes.
const PRICE_IN = 1.0;
const PRICE_OUT = 5.0;

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});

async function main() {
  // Arguments: an optional CSV path (relative to where you run it) and --dry-run.
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a.startsWith('-') && a !== '--dry-run');
  if (unknown.length) throw new Error(`Unknown option ${unknown.join(', ')}. The only option is --dry-run.`);
  const dryRun = args.includes('--dry-run');
  const csvArg = args.find((a) => !a.startsWith('-'));
  const csvFile = csvArg ? path.resolve(csvArg) : path.join(HERE, 'titles.csv');
  const csvName = path.relative(process.cwd(), csvFile);

  const profile = readProfile(path.join(HERE, 'profile.json'));
  const rows = readTitles(csvFile);
  const batches = chunk(rows, BATCH_SIZE);
  const strictness = profile.strictness ?? DEFAULT_STRICTNESS;

  if (dryRun) {
    const request = buildRequest(profile, batches[0]);
    console.log(`Dry run: ${rows.length} rows from ${csvName} would go out in ${batches.length} batch(es). First batch:\n`);
    console.log('--- system ---\n' + request.system);
    console.log('\n--- user ---\n' + request.messages[0].content);
    return;
  }

  const client = new Anthropic({ apiKey: loadApiKey(), maxRetries: 3 });

  console.log(`Scoring ${rows.length} rows from ${csvName} in ${batches.length} batch(es) with ${MODEL}, strictness ${strictness}\n`);

  const scores = new Map(); // row id -> { interest_match, substance, bait }
  let tokensIn = 0;
  let tokensOut = 0;

  for (const [i, batch] of batches.entries()) {
    process.stdout.write(`  batch ${i + 1}/${batches.length} (${batch.length} rows) ... `);
    try {
      const response = await client.messages.create(buildRequest(profile, batch));
      tokensIn += response.usage.input_tokens;
      tokensOut += response.usage.output_tokens;

      const batchScores = parseScores(response, batch);
      for (const [id, s] of batchScores) scores.set(id, s);

      const missing = batch.length - batchScores.size;
      console.log(missing ? `ok, but ${missing} row(s) missing from the reply (stop_reason: ${response.stop_reason})` : 'ok');
    } catch (err) {
      // Problems that would fail every batch (bad key, no credit, malformed
      // request): stop now rather than repeat the same error.
      if (err instanceof Anthropic.APIError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        console.log('failed');
        throw new Error(explainFatal(err));
      }
      // Network trouble, overload, rate limits (after the SDK's own retries):
      // skip this batch and carry on with the rest.
      console.log(`failed (${err.message}), skipping these rows`);
    }
  }

  // Rows the model never scored are left out of the agreement figures, so a
  // network blip doesn't count as a disagreement. (In production they'd be shown.)
  const scored = rows.filter((row) => scores.has(row.id));
  const unscored = rows.filter((row) => !scores.has(row.id));
  if (scored.length === 0) throw new Error('No rows were scored, so there is nothing to compare.');

  const modelVerdict = (row, level) => verdictFor(scores.get(row.id), level);
  const disagreements = scored.filter((row) => modelVerdict(row, strictness) !== row.myVerdict);

  // --- Disagreements -------------------------------------------------------
  console.log(`\nDisagreements (${disagreements.length}):`);
  if (disagreements.length === 0) console.log('  none');
  for (const row of disagreements) {
    const s = scores.get(row.id);
    console.log(
      `  row ${row.id.padEnd(4)} you: ${row.myVerdict}  model: ${modelVerdict(row, strictness)}` +
        `   interest ${s.interest_match}, substance ${s.substance}, bait ${s.bait}`,
    );
    console.log(`           ${row.title}  [${row.channel}]`);
  }

  if (unscored.length) {
    console.log(`\nNot scored, left out of the figures (${unscored.length}):`);
    for (const row of unscored) console.log(`  row ${row.id.padEnd(4)} ${row.title}`);
  }

  // --- Agreement -----------------------------------------------------------
  const agreed = scored.length - disagreements.length;
  const lostGood = disagreements.filter((row) => row.myVerdict === 'show').length;
  const missedBait = disagreements.length - lostGood;

  console.log(`\nAgreement: ${agreed}/${scored.length} = ${percent(agreed, scored.length)}  (target ${TARGET_PERCENT}%)`);
  console.log(`  you show, model hides: ${lostGood}  (good videos you'd lose)`);
  console.log(`  you hide, model shows: ${missedBait}  (bait that gets through)`);

  // Same scores, every strictness level: shows which setting fits your labels
  // best without spending anything on extra API calls.
  console.log('\nAgreement at each strictness (same scores, no extra API calls):');
  for (let level = 1; level <= 5; level++) {
    const hits = scored.filter((row) => modelVerdict(row, level) === row.myVerdict).length;
    const label = level === 1 ? 'lenient' : level === 5 ? 'strict' : '';
    const current = level === strictness ? '  <- profile.json' : '';
    console.log(`  ${level} ${label.padEnd(8)} ${percent(hits, scored.length).padStart(6)}${current}`);
  }

  const cost = (tokensIn * PRICE_IN + tokensOut * PRICE_OUT) / 1e6;
  console.log(`\nTokens: ${tokensIn.toLocaleString()} in, ${tokensOut.toLocaleString()} out  (about $${cost.toFixed(4)})`);
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

function loadApiKey() {
  try {
    process.loadEnvFile(path.join(ROOT, '.env'));
  } catch {
    // No .env file: the check below explains what to do.
  }
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) {
    throw new Error('No API key found. Put it in .env in the project root as ANTHROPIC_API_KEY=sk-ant-...');
  }
  return key;
}

function readProfile(file) {
  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Couldn't read ${file}: ${err.message}`);
  }
  if (typeof profile.rubric !== 'string' || !profile.rubric.trim()) {
    throw new Error('profile.json needs a non-empty "rubric" string.');
  }
  if (!Array.isArray(profile.interests)) {
    throw new Error('profile.json needs an "interests" list, e.g. ["chess", "theatre"].');
  }
  return profile;
}

// Returns [{ id, title, channel, myVerdict }]. id is the row number as a
// spreadsheet shows it (header = row 1), so you can find it easily.
function readTitles(file) {
  if (!fs.existsSync(file)) throw new Error(`Can't find ${file}`);
  const [header, ...lines] = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!header) throw new Error(`${file} is empty.`);

  const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const titleCol = col('title');
  const channelCol = col('channel');
  const verdictCol = col('my_verdict');
  if (titleCol === -1 || channelCol === -1 || verdictCol === -1) {
    throw new Error(`${file} needs the header row: title,channel,my_verdict`);
  }

  const rows = [];
  lines.forEach((fields, i) => {
    const rowNumber = String(i + 2);
    if (fields.every((f) => !f.trim())) return; // blank row
    const title = (fields[titleCol] || '').trim();
    const channel = (fields[channelCol] || '').trim();
    const myVerdict = (fields[verdictCol] || '').trim().toLowerCase();
    if (!title) {
      console.warn(`Skipping row ${rowNumber}: no title`);
    } else if (myVerdict !== 'show' && myVerdict !== 'hide') {
      console.warn(`Skipping row ${rowNumber}: my_verdict must be "show" or "hide", got "${myVerdict}"`);
    } else {
      rows.push({ id: rowNumber, title, channel, myVerdict });
    }
  });
  if (rows.length === 0) throw new Error(`${file} has no usable rows. Add labelled rows under the header.`);
  return rows;
}

// Minimal CSV parser. Handles quoted fields containing commas, quotes ("")
// and line breaks; Windows line endings; and the byte-order mark Excel adds
// when you save as "CSV UTF-8". Blank rows are kept so row numbers stay right.
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip byte-order mark
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function explainFatal(err) {
  if (err.status === 401) return 'The API rejected the key (401). Check ANTHROPIC_API_KEY in .env.';
  if (err.status === 402 || err.type === 'billing_error') {
    return 'The API says there is a billing problem. Add credit at console.anthropic.com.';
  }
  if (err.status === 403) return `The key doesn't have permission for this request (403): ${err.message}`;
  return `The API refused the request (${err.status}): ${err.message}`;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function percent(n, total) {
  return `${((100 * n) / total).toFixed(1)}%`;
}
