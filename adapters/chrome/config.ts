// adapters/chrome/config.ts
//
// Where the Chrome extension's servers are. host_permissions in
// manifest.json must match apiBaseUrl.
//   apiBaseUrl: the Worker. For local development 'http://127.0.0.1:8787'
//   (`npm run dev` in the project root); the deployed one is
//   https://worthwhile.worthwhile-worker.workers.dev.
//   profileUrl: the website's taste profile endpoint. Only used once a
//   website session ('authToken') is stored, which nothing in the extension
//   does yet, so for now the extension always uses its own settings.

import type { WorthwhileConfig } from '../../core/config';

declare const __DEV__: boolean;

export const CONFIG: WorthwhileConfig = {
  apiBaseUrl: 'http://127.0.0.1:8787',
  profileUrl: '', // not set up yet: set to the website's /api/taste-profile URL
  dev: __DEV__,
};
