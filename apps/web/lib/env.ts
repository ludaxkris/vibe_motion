/**
 * The only place in `apps/web` that reads environment variables.
 *
 * `NEXT_PUBLIC_API_ORIGIN` is inlined by Next at build time, so it must be
 * referenced literally (not via a computed key) for the replacement to happen.
 * Everything else imports `env` from here — never `process.env` directly.
 */
export const env = {
  /** Origin of the Ktor API (`apps/api`). Also the allow-listed origin for the preview bridge. */
  apiOrigin: process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:8080",
  /**
   * True when the app should serve the API from the MSW mocks (`mocks/`)
   * instead of the real Ktor API. Set by Playwright's `webServer` for e2e;
   * off by default so a production build never starts the mock worker.
   */
  apiMocking: process.env.NEXT_PUBLIC_API_MOCKING === "enabled",
  /** True in a production build. Gates dev-only routes such as `/dev/panel`. */
  isProduction: process.env.NODE_ENV === "production",
} as const;

export type Env = typeof env;
