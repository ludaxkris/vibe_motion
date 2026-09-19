/**
 * Why a clone failed, in the handoff's two-part shape: a bold sentence naming
 * the reason, plus a muted sentence saying what to do about it
 * (`docs/design/README.md` "1. Entry", error state 3b).
 *
 * The keys are the service's own vocabulary (`apps/api` `clone/PageCloner.kt`
 * and `Application.kt`): `invalid_url`, `url_blocked`, `url_unreachable` and
 * `not_html` (422), `page_too_large` and `payload_too_large` (413),
 * `clone_busy` (503) and `internal_error`. `openapi.yaml` types `Error.code` as
 * a bare string, so nothing enforces that from the contract side — the code is
 * matched first and the HTTP status is the fallback, which keeps an unknown
 * code from a newer API on the right sentence rather than on raw server prose.
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

type Sentences = {
  headline: string;
  detail: string;
  /**
   * The failure is about the page that was asked for, so the handoff's list of
   * the other things that can go wrong with a page is worth offering. False for
   * anything about the address, the request or the service itself, where that
   * list would only misdirect.
   */
  aboutThePage: boolean;
};

const BY_CODE: Record<string, Sentences> = {
  // -- Emitted by the service today ----------------------------------------
  url_unreachable: {
    headline: "Couldn’t clone this page — the site didn’t respond.",
    detail: "DNS failed, or the page took longer than 15 seconds. Check the address and try again.",
    aboutThePage: true,
  },
  url_blocked: {
    headline: "Couldn’t clone this page — that host is blocked.",
    detail: "Private, local and link-local addresses can’t be cloned. Use a public URL.",
    aboutThePage: true,
  },
  not_html: {
    headline: "Couldn’t clone this page — that address isn’t an HTML page.",
    detail: "PDFs, images and JSON can’t be cloned. Link to the page itself.",
    aboutThePage: true,
  },
  page_too_large: {
    headline: "Couldn’t clone this page — it’s over 10 MB.",
    detail: "The page and its CSS together have to stay under 10 MB.",
    aboutThePage: true,
  },
  invalid_url: {
    headline: "That isn’t a valid web address.",
    detail: "Enter a host and path, like nimbus.app/pricing.",
    aboutThePage: false,
  },
  /** The request body, not the page: `POST /projects` only carries the URL. */
  payload_too_large: {
    headline: "That request was too large to send.",
    detail: "The address itself is too long. Try the page without its query string.",
    aboutThePage: false,
  },
  clone_busy: {
    headline: "Vibe Motion is busy right now.",
    detail: "Too many pages are being cloned at once. Try again in a few seconds.",
    aboutThePage: false,
  },
  internal_error: {
    headline: "Something went wrong on our side.",
    detail:
      "Try again in a moment. If it keeps happening, this page may be one Vibe Motion can’t handle.",
    aboutThePage: false,
  },

  // -- Tolerated, not emitted yet -------------------------------------------
  /** The sentence the handoff showcases in state 3b. */
  login_required: {
    headline: "Couldn’t clone this page — it redirected to a sign-in screen.",
    detail:
      "Vibe Motion can only clone public pages. Try the public URL, or a page that doesn’t need a session.",
    aboutThePage: true,
  },
  /** Rate limiting lands in Phase 8 (docs/build_plan.md). */
  rate_limited: {
    headline: "Too many clone requests.",
    detail: "Wait a moment, then try again.",
    aboutThePage: false,
  },
};

/** One code per status, for when the code itself is not one we know. */
const BY_STATUS: Record<number, string> = {
  400: "invalid_url",
  // The page, not the request body: `POST /projects` sends one short URL.
  413: "page_too_large",
  429: "rate_limited",
  500: "internal_error",
  503: "clone_busy",
};

/** Shown when the server failed the clone without saying anything usable. */
const GENERIC_DETAIL = "Try another URL, or the same one again in a moment.";

/** The same sentences the server's `invalid_url` gets, for local validation. */
export const INVALID_URL_FAILURE: CloneFailure = {
  headline: BY_CODE.invalid_url.headline,
  detail: BY_CODE.invalid_url.detail,
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

/**
 * `BY_CODE[code]`, but only for a code the table actually declares.
 *
 * The code is a server-supplied string (`openapi.yaml` types `Error.code` as a
 * bare string; DT-077 tracks it), so a body of `{"code":"toString"}` would
 * otherwise resolve to the inherited function — truthy, with no `headline` and
 * no `detail` — instead of falling through to the generic sentences written
 * for exactly this case.
 */
function sentencesFor(code: string | undefined): Sentences | undefined {
  return code !== undefined && Object.hasOwn(BY_CODE, code) ? BY_CODE[code] : undefined;
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

  const sentences = sentencesFor(error.code) ?? sentencesFor(BY_STATUS[error.status]);
  if (sentences) {
    return {
      headline: sentences.headline,
      detail: sentences.detail,
      showOtherReasons: sentences.aboutThePage,
    };
  }

  // An unrecognised failure of a clone still is one, so the card applies.
  return {
    headline: "Couldn’t clone this page.",
    detail: error.message || GENERIC_DETAIL,
    showOtherReasons: true,
  };
}
