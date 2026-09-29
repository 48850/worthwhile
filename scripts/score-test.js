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
//   npm run score-test -- --shorts scripts/shorts.csv   score Shorts by video ID, with thumbnails
//   npm run score-test -- --shorts --no-images ...      the same from text only (to see what images add)
//
// Inputs:
//   .env                   ANTHROPIC_API_KEY=...        (gitignored)
//   scripts/profile.json   rubric, interests, strictness (same shape the options page saves)
//   the CSV                columns: title, channel, my_verdict (show|hide)
//                          --shorts: video_id, my_verdict (title and channel are
//                          optional; the Short's details come from YouTube, like
//                          the Worker). Needs YOUTUBE_API_KEY in .env or the
//                          environment. The Options page's "Copy as CSV" gives this format.
//
// titles.csv is the set you tune the rubric against. holdout.csv is a
// separate set you never tune against: its score is the honest estimate.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import {
  BAIT_THRESHOLD,
  BATCH_SIZE,
  DEFAULT_RULE,
  DEFAULT_STRICTNESS,
  MODEL,
  SHORTS_BATCH_SIZE,
  buildRequest,
  buildShortsRequest,
  parseScores,
  SHORTS_FRAMES,
  shortFromVideo,
  shortsImageUrl,
  verdictFor,
} from '../shared/prompt.js';

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
  const OPTIONS = ['--dry-run', '--shorts', '--no-images'];
  const unknown = args.filter((a) => a.startsWith('-') && !OPTIONS.includes(a));
  if (unknown.length) throw new Error(`Unknown option ${unknown.join(', ')}. The options are ${OPTIONS.join(', ')}.`);
  const dryRun = args.includes('--dry-run');
  const shorts = args.includes('--shorts');
  const images = !args.includes('--no-images');
  if (args.includes('--no-images') && !shorts) throw new Error('--no-images only applies with --shorts.');
  const csvArg = args.find((a) => !a.startsWith('-'));
  if (shorts && !csvArg) throw new Error('--shorts needs a CSV file, e.g. scripts/shorts.csv');
  const csvFile = csvArg ? path.resolve(csvArg) : path.join(HERE, 'titles.csv');
  const csvName = path.relative(process.cwd(), csvFile);

  const profile = readProfile(path.join(HERE, 'profile.json'));
  loadEnv();
  const rows = readTitles(csvFile, { shorts });
  if (shorts) await addShortDetails(rows, { images });
  const batches = chunk(rows, shorts ? SHORTS_BATCH_SIZE : BATCH_SIZE);
  const build = shorts ? buildShortsRequest : buildRequest;
  const strictness = profile.strictness ?? DEFAULT_STRICTNESS;
  const rule = profile.rule ?? DEFAULT_RULE;
  const ruleName = rule === 'strict' ? `strict rule, strictness ${strictness}` : `bait rule (bait >= ${BAIT_THRESHOLD})`;

  if (dryRun) {
    const request = build(profile, batches[0]);
    console.log(`Dry run: ${rows.length} rows from ${csvName} would go out in ${batches.length} batch(es). First batch:\n`);
    console.log('--- system ---\n' + request.system);
    const content = request.messages[0].content;
    const readable =
      typeof content === 'string'
        ? content
        : content.map((b) => (b.type === 'text' ? b.text : `  [thumbnail, ${Math.round((b.source.data.length * 3) / 4 / 1024)} KB]`)).join('\n');
    console.log('\n--- user ---\n' + readable);
    return;
  }

  const client = new Anthropic({ apiKey: loadApiKey(), maxRetries: 3 });

  const what = shorts ? (images ? 'Shorts with thumbnails' : 'Shorts, text only') : 'rows';
  console.log(`Scoring ${rows.length} ${what} from ${csvName} in ${batches.length} batch(es) with ${MODEL}, ${ruleName}\n`);

  const scores = new Map(); // row id -> { interest_match, substance, bait }
  let tokensIn = 0;
  let tokensOut = 0;

  for (const [i, batch] of batches.entries()) {
    process.stdout.write(`  batch ${i + 1}/${batches.length} (${batch.length} rows) ... `);
    try {
      const response = await client.messages.create(build(profile, batch));
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

  const modelVerdict = (row) => verdictFor(scores.get(row.id), { rule, strictness });
  const disagreements = scored.filter((row) => modelVerdict(row) !== row.myVerdict);

  // --- Disagreements -------------------------------------------------------
  console.log(`\nDisagreements (${disagreements.length}):`);
  if (disagreements.length === 0) console.log('  none');
  for (const row of disagreements) {
    const s = scores.get(row.id);
    console.log(
      `  row ${row.id.padEnd(4)} you: ${row.myVerdict}  model: ${modelVerdict(row)}` +
        `   interest ${s.interest_match}, substance ${s.substance}, bait ${s.bait}` +
        (row.category ? `   (${row.category})` : ''),
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

  // Same scores under the other rules: shows which setting fits your labels
  // best without spending anything on extra API calls.
  const tally = (hide) => {
    let hits = 0;
    let goodHidden = 0;
    for (const row of scored) {
      const verdict = hide(scores.get(row.id)) ? 'hide' : 'show';
      if (verdict === row.myVerdict) hits++;
      else if (row.myVerdict === 'show') goodHidden++;
    }
    return `${percent(hits, scored.length).padStart(6)}   good hidden: ${goodHidden}`;
  };
  console.log('\nOther settings (same scores, no extra API calls):');
  for (const n of [5, 6, 7, 8]) {
    const current = rule !== 'strict' && n === BAIT_THRESHOLD ? '  <- default' : '';
    console.log(`  bait >= ${n}            ${tally((s) => s.bait >= n)}${current}`);
  }
  for (let level = 1; level <= 5; level++) {
    const current = rule === 'strict' && level === strictness ? '  <- profile.json' : '';
    console.log(`  strict, strictness ${level} ${tally((s) => verdictFor(s, { rule: 'strict', strictness: level }) === 'hide')}${current}`);
  }

  const cost = (tokensIn * PRICE_IN + tokensOut * PRICE_OUT) / 1e6;
  console.log(`\nTokens: ${tokensIn.toLocaleString()} in, ${tokensOut.toLocaleString()} out  (about $${cost.toFixed(4)})`);
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

// Reads .env into process.env (keys already set in the environment win).
function loadEnv() {
  try {
    process.loadEnvFile(path.join(ROOT, '.env'));
  } catch {
    // No .env file: the key checks explain what to do.
  }
}

function loadApiKey() {
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

// Returns [{ id, title, channel, myVerdict, category, videoId }]. id is the
// row number as a spreadsheet shows it (header = row 1), so you can find it
// easily. shorts: video_id is required and title/channel are optional.
function readTitles(file, { shorts = false } = {}) {
  if (!fs.existsSync(file)) throw new Error(`Can't find ${file}`);
  const [header, ...lines] = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!header) throw new Error(`${file} is empty.`);

  const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const titleCol = col('title');
  const channelCol = col('channel');
  const verdictCol = col('my_verdict');
  const videoIdCol = col('video_id');
  if (shorts && (videoIdCol === -1 || verdictCol === -1)) {
    throw new Error(`${file} needs the columns video_id and my_verdict (Options > Collect Shorts > Copy as CSV gives them)`);
  }
  if (!shorts && (titleCol === -1 || channelCol === -1 || verdictCol === -1)) {
    throw new Error(`${file} needs the header row: title,channel,my_verdict`);
  }

  const rows = [];
  lines.forEach((fields, i) => {
    const rowNumber = String(i + 2);
    if (fields.every((f) => !f.trim())) return; // blank row
    const title = (fields[titleCol] || '').trim();
    const channel = (fields[channelCol] || '').trim();
    const myVerdict = (fields[verdictCol] || '').trim().toLowerCase();
    const videoId = videoIdCol === -1 ? '' : (fields[videoIdCol] || '').trim();
    if (shorts && !/^[\w-]{11}$/.test(videoId)) {
      console.warn(`Skipping row ${rowNumber}: video_id must be an 11-character YouTube ID, got "${videoId}"`);
    } else if (!shorts && !title) {
      console.warn(`Skipping row ${rowNumber}: no title`);
    } else if (myVerdict !== 'show' && myVerdict !== 'hide') {
      console.warn(`Skipping row ${rowNumber}: my_verdict must be "show" or "hide", got "${myVerdict}"`);
    } else {
      const category = col('category') === -1 ? '' : (fields[col('category')] || '').trim(); // optional column
      rows.push({ id: rowNumber, title, channel, myVerdict, category, videoId });
    }
  });
  if (rows.length === 0) throw new Error(`${file} has no usable rows. Add labelled rows under the header.`);
  return rows;
}

// Shorts: fills in each row's title, channel, tags, description and
// thumbnail from YouTube, the same way the Worker does (shared/prompt.js),
// so the test scores exactly what production would. Rows YouTube no longer
// has (deleted or private) keep the CSV's title and channel, with no image.
async function addShortDetails(rows, { images }) {
  const key = (process.env.YOUTUBE_API_KEY || '').trim();
  if (!key) throw new Error('--shorts needs YOUTUBE_API_KEY, in .env or as an environment variable.');

  const byId = new Map();
  for (const ids of chunk([...new Set(rows.map((row) => row.videoId))], 50)) {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.search = new URLSearchParams({ part: 'snippet', id: ids.join(','), key }).toString();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`YouTube videos.list failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
    for (const v of (await response.json()).items || []) byId.set(v.id, v);
  }

  let missing = 0;
  await Promise.all(
    rows.map(async (row) => {
      const v = byId.get(row.videoId);
      if (!v) {
        missing++;
        return;
      }
      Object.assign(row, shortFromVideo(v));
      if (images) {
        const [thumb, ...frames] = await Promise.all(['hqdefault', ...SHORTS_FRAMES].map((name) => fetchImage(row.videoId, name)));
        row.image = thumb;
        row.frames = thumb ? frames.filter(Boolean) : [];
      }
    }),
  );
  if (missing) console.warn(`${missing} Short(s) not found on YouTube (deleted or private): scored from the CSV's title and channel.`);
  const withImage = rows.filter((row) => row.image).length;
  if (images && withImage < rows.length) console.warn(`${rows.length - withImage} Short(s) have no thumbnail.`);
  // Nothing to judge without a title (the Worker leaves these unscored too).
  const untitled = rows.filter((row) => !row.title);
  for (const row of untitled) rows.splice(rows.indexOf(row), 1);
  if (untitled.length) console.warn(`Left out ${untitled.length} Short(s) with no title: rows ${untitled.map((row) => row.id).join(', ')}`);
}

async function fetchImage(videoId, name) {
  try {
    const response = await fetch(shortsImageUrl(videoId, name));
    const mediaType = (response.headers.get('content-type') || '').split(';')[0].trim();
    if (!response.ok || mediaType !== 'image/jpeg') return null;
    return { mediaType, data: Buffer.from(await response.arrayBuffer()).toString('base64') };
  } catch {
    return null;
  }
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
