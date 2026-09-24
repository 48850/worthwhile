// extension/settings.js
//
// The settings every part of the extension shares, with their defaults.
// Stored in chrome.storage.sync, so they follow the user between their own
// Chrome/Edge installs. Loaded by the content script, the background worker
// (importScripts), the toolbar popup and the options page.

const DEFAULT_SETTINGS = {
  enabled: true,
  token: '', // invite token, entered on the options page
  rubric:
    "Worthwhile means I come away understanding, knowing or appreciating something I didn't before. " +
    'Prefer depth over hype: explanations, analysis, craft, real expertise, full performances. ' +
    'Prefer independent and niche creators over mass-market channels. Humour is fine if it\'s clever. ' +
    'Hide ragebait, drama and gossip, reaction videos, clickbait titles that overpromise, AI-generated slop, ' +
    'hustle/motivation/get-rich content, generic top-10 lists, and mainstream hype.',
  interests: [], // edited in the toolbar popup
  rule: 'bait', // 'bait': hide clear bait only (default). 'strict': the original rule, uses strictness.
  strictness: 2, // Strict rule only: 1 (lenient) to 5 (strict). 2 passed the M1 holdout test.
  shortsLabels: false, // label bait Shorts (never skips); off by default
  hideShortsShelf: true, // hide the Shorts shelf on the home page: titles too thin to score, mostly slop
  hiddenChannels: [], // channel names hidden outright by "Hide channel", no model involved
};

const MAX_HIDDEN_CHANNELS = 200;

// Adds or removes a channel from the "Hide channel" list (matched by name,
// ignoring case).
async function setChannelHidden(name, hidden) {
  const { hiddenChannels } = await loadSettings();
  const others = hiddenChannels.filter((c) => c.toLowerCase() !== name.toLowerCase());
  await chrome.storage.sync.set({ hiddenChannels: hidden ? [name, ...others].slice(0, MAX_HIDDEN_CHANNELS) : others });
}

const SETTINGS_LIMITS = {
  interests: 20, // how many interests
  interestLength: 40, // characters per interest
  rubricLength: 2500, // characters; chrome.storage.sync allows about 8 KB per setting
};

// Resolves to the stored settings, with defaults filled in for anything unset.
function loadSettings() {
  return chrome.storage.sync.get(DEFAULT_SETTINGS);
}

// Things remembered on this device only (chrome.storage.local), never synced:
//   openedChannels: channels of videos opened from the grid, newest first.
//     Sourcing searches their latest uploads. [{ id?: "UC...", handle?: "@x", name }]
//   notInterested: video IDs we told YouTube "Not interested" about.
//   corrections: the user's "Show it anyway" / "Wrong call" clicks, newest
//     first. [{ videoId, title, channel, scores, verdict: 'show'|'hide', at }]
//     The 10 newest go to the scoring prompt as labelled examples.
//   worthOpen: whether the "Worth your time" row is expanded.
const LOCAL_DEFAULTS = { openedChannels: [], notInterested: [], corrections: [], worthOpen: true };
const MAX_OPENED_CHANNELS = 20;
const MAX_NOT_INTERESTED = 1000;
const MAX_CORRECTIONS = 20;
const MAX_EXAMPLES_SENT = 10;

function loadLocal() {
  return chrome.storage.local.get(LOCAL_DEFAULTS);
}

async function rememberChannel(channel) {
  if (!channel || (!channel.id && !channel.handle)) return;
  const { openedChannels } = await loadLocal();
  const same = (c) => (channel.id && c.id === channel.id) || (channel.handle && c.handle === channel.handle);
  const next = [channel, ...openedChannels.filter((c) => !same(c))].slice(0, MAX_OPENED_CHANNELS);
  await chrome.storage.local.set({ openedChannels: next });
}

async function rememberNotInterested(videoId) {
  const { notInterested } = await loadLocal();
  if (notInterested.includes(videoId)) return;
  await chrome.storage.local.set({ notInterested: [videoId, ...notInterested].slice(0, MAX_NOT_INTERESTED) });
}

// Records a correction; a newer one for the same video replaces the older.
async function rememberCorrection(correction) {
  const { corrections } = await loadLocal();
  const next = [{ ...correction, at: Date.now() }, ...corrections.filter((c) => c.videoId !== correction.videoId)];
  await chrome.storage.local.set({ corrections: next.slice(0, MAX_CORRECTIONS) });
}

// The newest corrections as prompt examples: [{ title, channel, verdict }].
function correctionExamples(corrections) {
  return corrections.slice(0, MAX_EXAMPLES_SENT).map(({ title, channel, verdict }) => ({ title, channel, verdict }));
}
