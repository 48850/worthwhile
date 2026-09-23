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
  strictness: 2, // 1 (lenient) to 5 (strict). 2 passed the M1 holdout test.
};

const SETTINGS_LIMITS = {
  interests: 20, // how many interests
  interestLength: 40, // characters per interest
  rubricLength: 2500, // characters; chrome.storage.sync allows about 8 KB per setting
};

// Resolves to the stored settings, with defaults filled in for anything unset.
function loadSettings() {
  return chrome.storage.sync.get(DEFAULT_SETTINGS);
}
