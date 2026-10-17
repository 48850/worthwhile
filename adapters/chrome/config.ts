// adapters/chrome/config.ts
//
// Where the Chrome extension's servers are. The build chooses the Worker
// (scripts/build.mjs): `npm run build` uses the deployed one; `npm run
// build:local` uses http://127.0.0.1:8787 (`npm run dev` in the project
// root). host_permissions in manifest.json must allow both.
//   profileUrl: the website's taste profile endpoint. Only used once a
//   website session ('authToken') is stored, which nothing in the extension
//   does yet, so for now the extension always uses its own settings.

import type { WorthwhileConfig } from '../../core/config';

declare const __DEV__: boolean;
declare const __API_BASE_URL__: string;

export const CONFIG: WorthwhileConfig = {
  apiBaseUrl: __API_BASE_URL__,
  profileUrl: '', // not set up yet: set to the website's /api/taste-profile URL
  dev: __DEV__,
};
