// core/config.ts
//
// Where Worthwhile's servers are. Each adapter supplies one:
//   Chrome: adapters/chrome/config.ts (built into the extension)
//   iOS:    window.__WORTHWHILE_CONFIG__, set by the app before filter.js runs

export interface WorthwhileConfig {
  /** The scoring server (the Worker), e.g. https://worthwhile.worthwhile-worker.workers.dev */
  apiBaseUrl: string;
  /** The website's taste profile endpoint. Default: <apiBaseUrl>/api/taste-profile. '' turns website profiles off. */
  profileUrl?: string;
  /** Development build: log analytics events. */
  dev?: boolean;
}

export function profileUrlOf(config: WorthwhileConfig): string {
  return config.profileUrl ?? `${config.apiBaseUrl}/api/taste-profile`;
}
