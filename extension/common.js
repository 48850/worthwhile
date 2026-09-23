// extension/common.js
//
// Small helpers shared by the content scripts: content.js (home feed),
// watch.js (/watch sidebar) and shorts.js (/shorts). Content scripts of one
// extension share their globals, so everything here is prefixed ww.

// Asks background.js to score items: { results } or { error }.
async function wwScore(items) {
  try {
    return await chrome.runtime.sendMessage({ type: 'score', items });
  } catch {
    return { error: 'extension-reloaded' }; // this page's script outlived an extension update
  }
}

// Asks background.js for approved videos from sourcing: { items } or { error }.
async function wwSource() {
  try {
    return await chrome.runtime.sendMessage({ type: 'source' });
  } catch {
    return { error: 'extension-reloaded' };
  }
}

function wwIsActive(settings) {
  return settings.enabled && Boolean(settings.token);
}

// Set by content.js when a feed tile is clicked, so watch.js can record the
// channel once the video's page has loaded. { videoId, channel, at }
const wwOpened = { pending: null };

// Element builder. Always textContent, never innerHTML: titles come from
// YouTube, and YouTube's page blocks innerHTML anyway.
function wwEl(tag, { id, className, text } = {}) {
  const node = document.createElement(tag);
  if (id) node.id = id;
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// Resolves with find()'s first truthy result, or null after timeoutMs.
function wwWaitFor(find, timeoutMs, intervalMs = 200) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const found = find();
      if (found || Date.now() - start > timeoutMs) resolve(found || null);
      else setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function wwSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A short message at the bottom of the page, e.g. "Skipped by Worthwhile".
function wwToast(text, ms = 2500) {
  let toast = document.getElementById('ww-toast');
  if (!toast) {
    toast = wwEl('div', { id: 'ww-toast' });
    document.documentElement.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add('ww-show');
  clearTimeout(wwToast.timer);
  wwToast.timer = setTimeout(() => toast.classList.remove('ww-show'), ms);
}
