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
} as const;

export type Env = typeof env;
