/**
 * Why a clone failed, in the handoff's two-part shape: a bold sentence naming
 * the reason, plus a muted sentence saying what to do about it
 * (`docs/design/README.md` "1. Entry", error state 3b).
 *
 * `apps/api/openapi.yaml` fixes the statuses `POST /projects` can answer with
 * (400 / 413 / 422 / 429) but types `Error.code` as a bare string, so the code
 * is matched first and the status is the fallback — an unknown code from a
 * newer API still lands on the right sentence rather than on raw server prose.
 */

export type CloneFailure = {
  /** Bold, 13px danger: the reason. */
  headline: string;
  /** Muted, same line: what to try instead. */
  detail: string;
  /** The handoff's "Other reasons a clone can fail" card belongs under it. */
  showOtherReasons: boolean;
};

/** A `POST /projects` response that was not 201, carrying what the body said. */
export class CloneRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CloneRequestError";
  }
}

type Sentences = Pick<CloneFailure, "headline" | "detail">;

const BY_CODE: Record<string, Sentences> = {
  login_required: {
    headline: "Couldn’t clone this page — it redirected to a sign-in screen.",
    detail:
      "Vibe Motion can only clone public pages. Try the public URL, or a page that doesn’t need a session.",
  },
  unreachable: {
    headline: "Couldn’t clone this page — the site didn’t respond.",
    detail: "DNS failed, or the page took longer than 15 seconds. Check the address and try again.",
  },
  blocked_host: {
    headline: "Couldn’t clone this page — that host is blocked.",
    detail: "Private, local and link-local addresses can’t be cloned. Use a public URL.",
  },
  not_html: {
    headline: "Couldn’t clone this page — that address isn’t an HTML page.",
    detail: "PDFs, images and JSON can’t be cloned. Link to the page itself.",
  },
  too_large: {
    headline: "Couldn’t clone this page — it’s over 10 MB.",
    detail: "The page and its CSS together have to stay under 10 MB.",
  },
  rate_limited: {
    headline: "Too many clone requests.",
    detail: "Wait a moment, then try again.",
  },
  invalid_url: {
    headline: "That isn’t a valid web address.",
    detail: "Enter a host and path, like nimbus.app/pricing.",
  },
};

/** openapi.yaml's response descriptions, one code each. */
const BY_STATUS: Record<number, string> = {
  400: "invalid_url",
  413: "too_large",
  429: "rate_limited",
};

/** Shown when the server failed the clone without saying anything usable. */
const GENERIC_DETAIL = "Try another URL, or the same one again in a moment.";

/** The same sentences the server's `invalid_url` gets, for local validation. */
export const INVALID_URL_FAILURE: CloneFailure = {
  ...BY_CODE.invalid_url,
  showOtherReasons: false,
};

/** The handoff's 2×2 card under the message, verbatim. */
export const OTHER_CLONE_FAILURE_REASONS = [
  { term: "Unreachable", detail: "DNS or timeout after 15 s" },
  { term: "Too large", detail: "over 10 MB including CSS" },
  { term: "Blocked host", detail: "private or local addresses" },
  { term: "Not HTML", detail: "PDFs, images, JSON" },
] as const;

/** True for the rejection an aborted `fetch` produces — a cancel, not a failure. */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export function describeCloneFailure(error: unknown): CloneFailure {
  if (!(error instanceof CloneRequestError)) {
    // Nothing came back at all: the network, not the page.
    return {
      headline: "Couldn’t reach Vibe Motion.",
      detail: "Check your connection and try again.",
      showOtherReasons: false,
    };
  }

  const code = error.code in BY_CODE ? error.code : (BY_STATUS[error.status] ?? "");
  // A malformed address is about what was typed, not about the page, so the
  // card of clone reasons under it would be noise.
  const showOtherReasons = code !== "invalid_url" && error.status !== 400;
  const sentences = BY_CODE[code];

  return sentences
    ? { ...sentences, showOtherReasons }
    : {
        headline: "Couldn’t clone this page.",
        detail: error.message || GENERIC_DETAIL,
        showOtherReasons,
      };
}
