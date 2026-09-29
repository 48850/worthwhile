# Worthwhile in the iOS app (WKWebView)

`npm run build` produces `dist/ios/filter.js`: one self-contained script
(an IIFE, no `chrome.*`, checked by the build) for a `WKWebView` showing
`m.youtube.com`. Everything the Chrome extension splits between a background
worker and content scripts runs inside this script. It reaches the app only
through the bridge below. The types are in `contracts/messages.ts`.

The app isn't built yet, and neither is the m.youtube.com page reading
(`sites/youtube-mobile`, every selector a TODO). Until those selectors are
filled in, the filter finds no cards and YouTube shows as normal.

## Injecting

Add two `WKUserScript`s at `.atDocumentStart`, main frame only, in the
page's world:

1. The config, before filter.js:

   ```js
   window.__WORTHWHILE_CONFIG__ = {
     apiBaseUrl: "https://worthwhile.worthwhile-worker.workers.dev", // the Worker
     profileUrl: "",   // the website's /api/taste-profile, if filter.js should fetch it (via "http")
     dev: false,       // true: log every analytics event (as "log" messages)
     settings: { enabled: true, token: "set" }, // see "Settings" below
     profile: { ... }  // optional: the TasteProfile the app fetched (validated; invalid means ignored)
   };
   ```

2. The contents of `dist/ios/filter.js`.

Register a `WKScriptMessageHandlerWithReply` named `worthwhile`
(`userContentController.addScriptMessageHandler(_:contentWorld: .page, name: "worthwhile")`).
The page calls `window.webkit.messageHandlers.worthwhile.postMessage(message)`
and awaits the reply the handler returns.

## Messages the app must handle (page -> app)

Every message is a dictionary with a `type`. Reply with a JSON-compatible
value (return `(reply, nil)` from the handler).

| type | fields | reply |
|---|---|---|
| `storage.get` | `area`: `"settings"` / `"local"` / `"session"`; `defaults`: object | An object holding the **stored** values for those keys (omit keys you don't have: the page fills in the defaults). |
| `storage.set` | `area`; `values`: object | `{ "ok": true }`. Store the values; then call `storage.changed` on every open page (below). |
| `http` | `request`: `{ method: "GET"/"POST", url, body?, auth: "invite"/"account"/"none", timeoutMs }` | `{ "status": Int, "body": parsed JSON or null }`; if the request couldn't be made: `{ "error": "network", "detail": String }`; if the token `auth` names isn't set: `{ "error": "no-token" }`. The app adds the token: `auth: "invite"` → `Authorization: Bearer <invite token>` (for the Worker); `"account"` → the website session token. POST bodies are JSON (`content-type: application/json`). Parse the response body as JSON only for 2xx. |
| `message` | `message`: `{ type: "events", events: [...] }` | `{ "ok": true }`. Analytics events (`contracts/events.ts`). Nothing needs to happen with them yet; keep or forward them later. |
| `log` | `level`: `"debug"`/`"warn"`/`"error"`; `text` | Nothing needed. Development builds only. |

`area` meanings:

- `settings`: the user's settings (the extension's `chrome.storage.sync`).
  Keys and defaults: `core/settings.ts` `DEFAULT_SETTINGS`.
- `local`: this device's data (corrections, session records, the cached
  taste profile, `authToken`: see below).
- `session`: cleared when the app restarts (`serverStatus`).

## Messages the app can send (app -> page)

Call `webView.evaluateJavaScript("window.__worthwhile.receive(\(json))")`;
the result is the reply.

| type | fields | reply |
|---|---|---|
| `storage.changed` | `area`; `changes`: `{ key: { oldValue?, newValue? } }` | `{ "ok": true }`. Send after every `storage.set`, and whenever the app itself changes a setting. |
| `receipt.request` | (none) | `{ "current": ReceiptCounts, "last": ReceiptCounts or null }`: the current session so far, and the last finished one (with its rating once given). |

## Settings and tokens

Tokens never enter the page:

- The invite token (for the Worker) stays in the app. In `settings`, give
  `token` any non-empty value (e.g. `"set"`) once the app has one: the page
  only checks that it exists. `http` requests with `auth: "invite"` get the
  real token from the app.
- The website session: the app can fetch the taste profile itself and pass
  it as `__WORTHWHILE_CONFIG__.profile`. Or it can set `profileUrl` and keep
  the session token for `auth: "account"` requests, with a non-empty
  `authToken` in `local` (again, any value: it's only checked for
  presence).

## What happens inside filter.js

- **Scoring:** feed items are scored by the Worker (`/score`), through `http`,
  exactly as in the extension (`core/host.ts`).
- **Decisions:** `core/decide.ts` decides show, hide or hallmark, applying
  the taste profile's `always_hide`, `respected_creators` and
  `shorts_policy`.
- **Sessions:** heartbeats keep the session in `local`
  (`core/session.ts`), and ended sessions go to the Worker's `/session`.
  The rating question and the fatigue offer come back in the heartbeat's
  reply. Showing them is the app's job (TODO: a native prompt, then send
  the answer as a `rate` app message).
- **Fail safe:** with no config, no bridge or any error, the page is left
  alone.
