/// <reference types="node" />
// scripts/eval.ts
//
// The classifier eval: runs labelled videos through classifier v2 (the
// exact requests the server sends, shared/classify.ts) and the on-device
// decision (core/relevance.ts, with a taste profile), and reports:
//   - end-to-end agreement: the final show/cut against your verdicts, at
//     every Range position and at the default;
//   - junk precision and recall (sets labelled for junk, or with a junk
//     column);
//   - every disagreement, with the classification behind it;
//   - cost per run.
//
//   npm run eval                          the tuning sets (below)
//   npm run eval -- --holdout             the holdout sets. Run once per classifier version.
//   npm run eval -- --models haiku-4.5,haiku-5.5   compare models (shared/classify.ts MODELS)
//   npm run eval -- file.csv [--kind short] [--labels junk]   any labelled CSV
//   npm run eval -- --range 0.5 --floor 0.4   the operating point for the disagreement list
//   npm run eval -- --only-disagreements scripts/eval-out/<run>.json   re-run only those rows
//   npm run eval -- --dry-run             print the first request, no API call
//   npm run eval -- --list-models         the models this API key can use
//
// CSV columns: my_verdict (show | hide) and either title + channel or
// video_id (Shorts are looked up on YouTube, like the server does; needs
// YOUTUBE_API_KEY). Optional: junk (yes | no), kind (feed | short).
// Keys come from the environment, .env, or the Windows user environment.
// Classifications and YouTube lookups are cached in scripts/.eval-cache
// (lookups for 30 days, YouTube's limit for stored API data), so a re-run
// with the same prompt and model costs nothing.

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { VideoClassification } from '../contracts/classification';
import { validateTasteProfile } from '../core/profile';
import { DEFAULT_RANGE, judge, prepareProfile, QUALITY_FLOOR, whyLine, type ItemVerdict, type PreparedProfile } from '../core/relevance';
import {
  BATCH_SIZE,
  buildClassifyRequest,
  classifierFingerprint,
  CLASSIFIER_VERSION,
  costOf,
  DEFAULT_MODEL,
  MODELS,
  parseClassifications,
  SHORTS_BATCH_SIZE,
  type ClassifyInput,
  type ModelConfig,
} from '../shared/classify';

const ROOT = path.resolve(path.dirname(process.argv[1]), '..');
const CACHE_DIR = path.join(ROOT, 'scripts', '.eval-cache');
const OUT_DIR = path.join(ROOT, 'scripts', 'eval-out');
const LOOKUP_DAYS = 30;
const PARALLEL = 3;
const RANGES = [0, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const FLOORS = [0.3, 0.4, 0.5, 0.6];
const TARGET = 0.85;

type Kind = 'feed' | 'short';
type Labels = 'verdict' | 'junk'; // what my_verdict means: your verdict, or "is it junk"

interface EvalSet {
  file: string;
  kind: Kind;
  labels: Labels;
  note: string;
}

const TUNING: EvalSet[] = [
  { file: 'scripts/titles.csv', kind: 'feed', labels: 'verdict', note: 'your verdicts' },
  { file: 'scripts/edge-cases.csv', kind: 'feed', labels: 'junk', note: 'labelled under the bait rule, so hide = junk' },
  { file: 'scripts/shorts-tuning.csv', kind: 'short', labels: 'verdict', note: 'drafted by Claude from your rubric, accepted by you' },
];
const HOLDOUT: EvalSet[] = [
  { file: 'scripts/holdout.csv', kind: 'feed', labels: 'verdict', note: 'your verdicts; unseen by classifier v2' },
  { file: 'scripts/shorts-holdout.csv', kind: 'short', labels: 'verdict', note: 'drafted by Claude, accepted by you; unseen by classifier v2' },
];

interface Row {
  set: EvalSet;
  n: number; // spreadsheet row number (header = 1)
  key: string; // file + row, stable across runs
  videoId: string | null;
  title: string;
  channel: string;
  label: 'show' | 'hide';
  junk: boolean | null;
  category: string;
  input: ClassifyInput | null; // null: can't be classified (e.g. a Short YouTube no longer has)
  c?: VideoClassification;
  cost?: number;
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const option = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const optionNames = ['--models', '--model', '--range', '--floor', '--profile', '--kind', '--labels', '--only-disagreements'];
const files = argv.filter((a, i) => !a.startsWith('--') && !optionNames.includes(argv[i - 1]));

const modelKeys = (option('--models') || option('--model') || DEFAULT_MODEL).split(',').map((m) => m.trim());
const range = Number(option('--range') ?? DEFAULT_RANGE);
const floor = Number(option('--floor') ?? QUALITY_FLOOR);
const profileFile = option('--profile') || 'scripts/taste-profile.json';

main().catch((err) => {
  console.error(`\nError: ${err?.message || err}`);
  process.exit(1);
});

async function main() {
  for (const key of modelKeys) if (!MODELS[key]) throw new Error(`Unknown model "${key}". Known: ${Object.keys(MODELS).join(', ')}`);

  if (flag('--list-models')) {
    const client = new Anthropic({ apiKey: requireKey('ANTHROPIC_API_KEY') });
    for await (const model of client.models.list()) console.log(`${model.id}  ${model.display_name}`);
    return;
  }

  const sets: EvalSet[] = files.length
    ? files.map((file) => ({
        file,
        kind: (option('--kind') as Kind) || (/short/i.test(path.basename(file)) ? 'short' : 'feed'),
        labels: (option('--labels') as Labels) || 'verdict',
        note: 'given on the command line',
      }))
    : flag('--holdout')
      ? HOLDOUT
      : TUNING;

  const taste = JSON.parse(fs.readFileSync(path.resolve(ROOT, profileFile), 'utf8'));
  const check = validateTasteProfile(taste);
  if (!check.ok) throw new Error(`${profileFile} isn't a valid taste profile:\n  ${check.errors.join('\n  ')}`);
  const profile = prepareProfile(check.profile);

  let rows = sets.flatMap(readRows);
  const only = option('--only-disagreements');
  if (only) {
    const keys = new Set<string>(JSON.parse(fs.readFileSync(path.resolve(ROOT, only), 'utf8')).disagreements);
    rows = rows.filter((r) => keys.has(r.key));
    console.log(`Only the ${rows.length} rows that disagreed in ${only}.`);
  }
  await addYouTubeDetails(rows);

  if (flag('--dry-run')) {
    const first = rows.filter((r) => r.input).slice(0, rows[0]?.set.kind === 'short' ? SHORTS_BATCH_SIZE : BATCH_SIZE);
    const request = buildClassifyRequest(numbered(first), MODELS[modelKeys[0]], { shorts: first[0]?.set.kind === 'short' });
    console.log(JSON.stringify(request, (k, v) => (k === 'data' && typeof v === 'string' ? `<${v.length} base64 chars>` : v), 2));
    return;
  }

  console.log(`Classifier ${CLASSIFIER_VERSION}. Profile: ${profileFile}. Operating point: Range ${range}, quality floor ${floor}.`);
  const summaries: Summary[] = [];
  for (const key of modelKeys) summaries.push(await runModel(key, rows.map((r) => ({ ...r })), sets, profile));
  if (summaries.length > 1) printComparison(summaries);
}

// ---------------------------------------------------------------------------
// One model over every set
// ---------------------------------------------------------------------------

interface Summary {
  model: string;
  verdictAgreement: Record<Kind, { agree: number; total: number }>;
  junkF1: number | null;
  costThisRun: number;
  costUncached: number;
  items: number;
  seconds: number;
}

async function runModel(key: string, rows: Row[], sets: EvalSet[], profile: PreparedProfile): Promise<Summary> {
  const config = MODELS[key];
  console.log(`\n${'='.repeat(78)}\nModel: ${key} (${config.model}${config.effort ? `, effort ${config.effort}` : ''}${config.thinking ? `, thinking ${config.thinking}` : ''})`);
  const started = Date.now();
  const spent = await classifyAll(rows, config);
  const seconds = (Date.now() - started) / 1000;

  const summary: Summary = {
    model: key,
    verdictAgreement: { feed: { agree: 0, total: 0 }, short: { agree: 0, total: 0 } },
    junkF1: null,
    costThisRun: spent,
    costUncached: rows.reduce((sum, r) => sum + (r.cost || 0), 0),
    items: rows.filter((r) => r.c).length,
    seconds,
  };
  const disagreements: string[] = [];
  const junkCounts = { tp: 0, fp: 0, fn: 0 };

  for (const set of sets) {
    const setRows = rows.filter((r) => r.set.file === set.file);
    if (!setRows.length) continue;
    const scored = setRows.filter((r) => r.c);
    console.log(`\n== ${set.file} (${set.kind === 'short' ? 'Shorts' : 'feed'}; ${set.note}): ${setRows.length} rows, ${scored.length} classified`);
    const missing = setRows.filter((r) => !r.c);
    if (missing.length) console.log(`   Not classified (left out of the %): ${missing.map((r) => `row ${r.n}`).join(', ')}`);

    if (set.labels === 'verdict') {
      // End-to-end at every Range, then the floor at the chosen Range.
      const atRange = (rg: number, fl = floor, maxAppeal?: number) =>
        agreement(scored, (r) => decide(r, profile, rg, fl, maxAppeal).action === (r.label === 'hide' ? 'cut' : 'show'));
      console.log(`   Range           ${RANGES.map((rg) => rg.toFixed(2).padStart(6)).join('')}`);
      console.log(`   Agreement       ${RANGES.map((rg) => pct(atRange(rg)).padStart(6)).join('')}`);
      console.log(`   (relevance only ${RANGES.map((rg) => pct(atRange(rg, floor, 0)).padStart(6)).join('')})`);
      console.log(`   Floor at Range ${range}: ${FLOORS.map((fl) => `${fl} → ${pct(atRange(range, fl))}`).join(',  ')}`);
      const here = atRange(range);
      console.log(`   At Range ${range}, floor ${floor}: ${here.agree}/${here.total} = ${pct(here)}${here.agree / here.total < TARGET ? '  (under 85%)' : ''}`);
      summary.verdictAgreement[set.kind].agree += here.agree;
      summary.verdictAgreement[set.kind].total += here.total;
    } else {
      // Junk labels: "cut as junk" (junk, or under the floor) against hide.
      const isCut = (r: Row) => Boolean(r.c!.junk) || r.c!.quality < floor;
      const m = junkMetrics(scored, isCut, (r) => r.label === 'hide');
      junkCounts.tp += m.tp;
      junkCounts.fp += m.fp;
      junkCounts.fn += m.fn;
      console.log(`   Junk (cut at every Range) vs your "hide": precision ${pct1(m.precision)}, recall ${pct1(m.recall)}, agreement ${pct({ agree: m.agree, total: scored.length })}`);
      console.log(`   Floor: ${FLOORS.map((fl) => {
        const f = junkMetrics(scored, (r) => Boolean(r.c!.junk) || r.c!.quality < fl, (r) => r.label === 'hide');
        return `${fl} → P ${pct1(f.precision)} R ${pct1(f.recall)}`;
      }).join(',  ')}`);
    }

    // A junk column on any set: junk precision and recall too.
    const withJunk = scored.filter((r) => r.junk != null);
    if (withJunk.length && set.labels === 'verdict') {
      const m = junkMetrics(withJunk, (r) => Boolean(r.c!.junk) || r.c!.quality < floor, (r) => r.junk === true);
      junkCounts.tp += m.tp;
      junkCounts.fp += m.fp;
      junkCounts.fn += m.fn;
      console.log(`   Junk column (${withJunk.length} rows): precision ${pct1(m.precision)}, recall ${pct1(m.recall)}`);
    }

    // Every disagreement at the operating point.
    const wrong = scored.filter((r) => {
      if (set.labels === 'junk') return (Boolean(r.c!.junk) || r.c!.quality < floor) !== (r.label === 'hide');
      return decide(r, profile, range, floor).action !== (r.label === 'hide' ? 'cut' : 'show');
    });
    if (wrong.length) {
      console.log(`   Disagreements (${wrong.length}):`);
      for (const r of wrong) {
        disagreements.push(r.key);
        const v = decide(r, profile, set.labels === 'junk' ? 1 : range, floor);
        const c = r.c!;
        console.log(`   - row ${r.n}: you ${r.label}, we ${v.action === 'cut' ? 'cut' : 'show'}${r.category ? ` [${r.category}]` : ''}`);
        console.log(`     "${r.title}" (${r.channel})`);
        console.log(`     q ${c.quality.toFixed(1)}  junk ${c.junk ?? 'none'}  ${c.format}  ${c.topics.join('/')}  ${c.depth}  rel ${v.relevance.toFixed(2)}  fit ${v.fit.toFixed(2)}  tags: ${c.tags.join(', ')}`);
        console.log(`     ${whyLine(v, c)}`);
      }
    }
  }

  if (junkCounts.tp + junkCounts.fp + junkCounts.fn > 0) {
    const precision = junkCounts.tp / Math.max(1, junkCounts.tp + junkCounts.fp);
    const recall = junkCounts.tp / Math.max(1, junkCounts.tp + junkCounts.fn);
    summary.junkF1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  }

  console.log(`\nCost: $${spent.toFixed(4)} this run; $${summary.costUncached.toFixed(4)} for the whole run uncached ($${((summary.costUncached / Math.max(1, summary.items)) * 1000).toFixed(2)} per 1,000 videos). ${seconds.toFixed(0)} s.`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${key}.json`);
  fs.writeFileSync(
    out,
    JSON.stringify(
      { model: key, classifier: CLASSIFIER_VERSION, range, floor, disagreements, rows: rows.map(({ set, input, ...r }) => ({ file: set.file, ...r })) },
      null,
      1,
    ),
  );
  console.log(`Results: ${path.relative(ROOT, out)}`);
  return summary;
}

// maxAppeal 0: Range moves relevance alone (the brief's first wording), for comparison.
function decide(r: Row, profile: PreparedProfile, rg: number, fl: number, maxAppeal?: number): ItemVerdict {
  return judge({ item: { title: r.title, channel: r.channel, isShort: r.set.kind === 'short' }, classification: r.c, profile, range: rg, floor: fl, maxAppeal });
}

function printComparison(summaries: Summary[]) {
  console.log(`\n${'='.repeat(78)}\nComparison at Range ${range}, floor ${floor}`);
  console.log(`${'model'.padEnd(18)}${'feed'.padStart(9)}${'Shorts'.padStart(9)}${'junk F1'.padStart(9)}${'$/run'.padStart(10)}${'$/1,000'.padStart(9)}${'secs'.padStart(7)}`);
  for (const s of summaries) {
    console.log(
      `${s.model.padEnd(18)}${pct(s.verdictAgreement.feed).padStart(9)}${pct(s.verdictAgreement.short).padStart(9)}${(s.junkF1 == null ? '-' : pct1(s.junkF1)).padStart(9)}` +
        `${('$' + s.costUncached.toFixed(4)).padStart(10)}${('$' + ((s.costUncached / Math.max(1, s.items)) * 1000).toFixed(2)).padStart(9)}${s.seconds.toFixed(0).padStart(7)}`,
    );
  }
  console.log('($/run: the whole run uncached. secs: this run, so cached runs look fast.)');
}

// ---------------------------------------------------------------------------
// Classifying (with a cache)
// ---------------------------------------------------------------------------

interface CacheEntry {
  c: VideoClassification;
  cost: number;
}

async function classifyAll(rows: Row[], config: ModelConfig): Promise<number> {
  const cacheFile = path.join(CACHE_DIR, 'classifications.json');
  const cache: Record<string, CacheEntry> = readJson(cacheFile, {});
  const client = new Anthropic({ apiKey: requireKey('ANTHROPIC_API_KEY'), maxRetries: 3, timeout: 120_000 });
  let spent = 0;
  let calls = 0;

  const todo: { kind: Kind; rows: Row[] }[] = [];
  for (const kind of ['feed', 'short'] as Kind[]) {
    const fingerprint = classifierFingerprint(config, { shorts: kind === 'short' });
    const pending: Row[] = [];
    for (const r of rows.filter((r) => r.set.kind === kind && r.input)) {
      const hit = cache[cacheKey(fingerprint, r.input!)];
      if (hit) {
        r.c = hit.c;
        r.cost = hit.cost;
      } else if (!pending.some((p) => sameInput(p, r))) pending.push(r);
    }
    const size = kind === 'short' ? SHORTS_BATCH_SIZE : BATCH_SIZE;
    for (let i = 0; i < pending.length; i += size) todo.push({ kind, rows: pending.slice(i, i + size) });
  }

  const totalItems = todo.reduce((n, b) => n + b.rows.length, 0);
  if (totalItems) process.stdout.write(`Classifying ${totalItems} videos in ${todo.length} calls`);
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const batch = todo[next++];
      const shorts = batch.kind === 'short';
      const fingerprint = classifierFingerprint(config, { shorts });
      const items = numbered(batch.rows);
      try {
        const response: any = await client.messages.create(buildClassifyRequest(items, config, { shorts }) as any);
        calls++;
        const cost = costOf(response.usage, config);
        spent += cost;
        if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') process.stdout.write(` [${response.stop_reason}]`);
        const parsed = parseClassifications(response, items);
        batch.rows.forEach((r, i) => {
          const c = parsed.get(String(i + 1));
          if (!c) return;
          cache[cacheKey(fingerprint, r.input!)] = { c, cost: cost / batch.rows.length };
        });
        process.stdout.write('.');
      } catch (err: any) {
        process.stdout.write(` [failed: ${err?.status ?? ''} ${String(err?.message || err).slice(0, 120)}]`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
  if (totalItems) process.stdout.write(` ${calls} calls.\n`);
  writeJson(cacheFile, cache);

  // Fill in everything (duplicates of the same video included) from the cache.
  for (const r of rows.filter((r) => r.input && !r.c)) {
    const hit = cache[cacheKey(classifierFingerprint(config, { shorts: r.set.kind === 'short' }), r.input!)];
    if (hit) {
      r.c = hit.c;
      r.cost = hit.cost;
    }
  }
  return spent;
}

// The model sees short numbers as ids, never video IDs (as on the server).
function numbered(rows: Row[]): ClassifyInput[] {
  return rows.map((r, i) => ({ ...r.input!, id: String(i + 1) }));
}

function cacheKey(fingerprint: string, input: ClassifyInput): string {
  const { id, image, ...rest } = input;
  const imageHash = image ? sha256(image.data) : '';
  return sha256(`${fingerprint}\n${JSON.stringify(rest)}\n${imageHash}`);
}

function sameInput(a: Row, b: Row): boolean {
  const { id: _a, ...ra } = a.input!;
  const { id: _b, ...rb } = b.input!;
  return JSON.stringify(ra) === JSON.stringify(rb);
}

// ---------------------------------------------------------------------------
// Reading the sets, and YouTube details for rows with a video_id
// ---------------------------------------------------------------------------

function readRows(set: EvalSet): Row[] {
  const text = fs.readFileSync(path.resolve(ROOT, set.file), 'utf8').replace(/^﻿/, '');
  const [header, ...records] = parseCsv(text);
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const [cTitle, cChannel, cVerdict, cId, cJunk, cCategory, cKind] = ['title', 'channel', 'my_verdict', 'video_id', 'junk', 'category', 'kind'].map(col);
  if (cVerdict < 0) throw new Error(`${set.file}: needs a my_verdict column`);
  const rows: Row[] = [];
  records.forEach((record, i) => {
    const label = (record[cVerdict] || '').trim().toLowerCase();
    if (label !== 'show' && label !== 'hide') return; // unlabelled
    const kind = cKind >= 0 && ['feed', 'short'].includes(record[cKind]?.trim()) ? (record[cKind].trim() as Kind) : set.kind;
    const junkText = cJunk >= 0 ? (record[cJunk] || '').trim().toLowerCase() : '';
    const videoId = cId >= 0 && /^[\w-]{11}$/.test((record[cId] || '').trim()) ? record[cId].trim() : null;
    const title = cTitle >= 0 ? (record[cTitle] || '').trim() : '';
    const channel = cChannel >= 0 ? (record[cChannel] || '').trim() : '';
    rows.push({
      set: kind === set.kind ? set : { ...set, kind },
      n: i + 2,
      key: `${set.file}:${i + 2}`,
      videoId,
      title,
      channel,
      label,
      junk: junkText === 'yes' ? true : junkText === 'no' ? false : null,
      category: cCategory >= 0 ? (record[cCategory] || '').trim() : '',
      input: title ? { id: '', title, channel } : null,
    });
  });
  return rows;
}

interface VideoDetails {
  fetchedAt: number;
  title: string;
  channel: string;
  description: string;
  tags: string[];
  duration: string;
}

// Rows with a video_id get what the server would send: YouTube's title,
// channel, tags, the start of the description and the duration; Shorts
// also get their thumbnail. Rows without one keep their title and channel
// only (what a home-feed card shows).
async function addYouTubeDetails(rows: Row[]) {
  const withId = rows.filter((r) => r.videoId);
  if (!withId.length) return;
  const file = path.join(CACHE_DIR, 'videos.json');
  const cache: Record<string, VideoDetails | null> = readJson(file, {});
  const fresh = (d: VideoDetails | null | undefined) => d !== undefined && (d === null || Date.now() - d.fetchedAt < LOOKUP_DAYS * 86400e3);
  const needed = [...new Set(withId.map((r) => r.videoId!))].filter((id) => !fresh(cache[id]));
  if (needed.length) {
    const key = requireKey('YOUTUBE_API_KEY');
    for (let i = 0; i < needed.length; i += 50) {
      const ids = needed.slice(i, i + 50);
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${ids.join(',')}&key=${encodeURIComponent(key)}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`YouTube videos.list: HTTP ${response.status}`);
      const data: any = await response.json();
      const found = new Map<string, any>((data.items || []).map((v: any) => [v.id, v]));
      for (const id of ids) {
        const v = found.get(id);
        const clip = (text: unknown, max: number) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
        cache[id] = v
          ? {
              fetchedAt: Date.now(),
              title: clip(v.snippet?.title, 300),
              channel: clip(v.snippet?.channelTitle, 150),
              description: clip(v.snippet?.description, 300),
              tags: (v.snippet?.tags || []).slice(0, 10).map((t: string) => clip(t, 40)),
              duration: clock(v.contentDetails?.duration),
            }
          : null; // deleted or private
      }
    }
    writeJson(file, cache);
  }

  for (const r of withId) {
    const d = cache[r.videoId!];
    if (!d) {
      if (r.set.kind === 'short') r.input = null; // the server couldn't classify it either
      continue;
    }
    r.title = d.title;
    r.channel = d.channel;
    r.input = { id: '', title: d.title, channel: d.channel, description: d.description || undefined, tags: d.tags.length ? d.tags : undefined };
    if (r.set.kind === 'feed' && d.duration) r.input.duration = d.duration;
    if (r.set.kind === 'short') r.input.image = await thumbnail(r.videoId!);
  }
}

// A Short's thumbnail (480x360, the vertical frame in the middle), as the server fetches it.
async function thumbnail(id: string): Promise<{ mediaType: string; data: string } | null> {
  const dir = path.join(CACHE_DIR, 'thumbs');
  const file = path.join(dir, `${id}.jpg`);
  try {
    if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < LOOKUP_DAYS * 86400e3) {
      return { mediaType: 'image/jpeg', data: fs.readFileSync(file).toString('base64') };
    }
    const response = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, bytes);
    return { mediaType: 'image/jpeg', data: bytes.toString('base64') };
  } catch {
    return null;
  }
}

// ISO 8601 (PT1H2M3S) -> "1:02:03" / "2:03", as YouTube shows it.
function clock(iso: string | undefined): string {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return '';
  const [h, min, s] = [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)];
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(min)}:${pad(s)}` : `${min}:${pad(s)}`;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function agreement(rows: Row[], agrees: (r: Row) => boolean) {
  return { agree: rows.filter(agrees).length, total: rows.length };
}

function junkMetrics(rows: Row[], predicted: (r: Row) => boolean, actual: (r: Row) => boolean) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let agree = 0;
  for (const r of rows) {
    const p = predicted(r);
    const a = actual(r);
    if (p && a) tp++;
    else if (p && !a) fp++;
    else if (!p && a) fn++;
    if (p === a) agree++;
  }
  return { tp, fp, fn, agree, precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn) };
}

function pct({ agree, total }: { agree: number; total: number }): string {
  return total ? `${((agree / total) * 100).toFixed(1)}%` : '-';
}

function pct1(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

// A key from the environment, then .env, then (Windows) the user environment.
function requireKey(name: string): string {
  if (process.env[name]) return process.env[name]!;
  try {
    process.loadEnvFile(path.join(ROOT, '.env'));
  } catch {
    // no .env
  }
  if (process.env[name]) return process.env[name]!;
  if (process.platform === 'win32') {
    try {
      const value = execFileSync('powershell', ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${name}', 'User')`], {
        encoding: 'utf8',
      }).trim();
      if (value) return (process.env[name] = value);
    } catch {
      // fall through
    }
  }
  throw new Error(`${name} isn't set (environment, .env, or Windows user environment)`);
}

// RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}
