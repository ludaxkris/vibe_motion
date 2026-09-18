import { describe, expect, it } from "vitest";

import {
  CloneRequestError,
  INVALID_URL_FAILURE,
  OTHER_CLONE_FAILURE_REASONS,
  describeCloneFailure,
  isAbortError,
} from "./clone-failure";

const failure = (status: number, code: string, message = "server detail") =>
  new CloneRequestError(status, code, message);

describe("describeCloneFailure", () => {
  it.each([
    [
      422,
      "login_required",
      "Couldn’t clone this page — it redirected to a sign-in screen.",
      "Vibe Motion can only clone public pages. Try the public URL, or a page that doesn’t need a session.",
    ],
    [
      422,
      "unreachable",
      "Couldn’t clone this page — the site didn’t respond.",
      "DNS failed, or the page took longer than 15 seconds. Check the address and try again.",
    ],
    [
      422,
      "blocked_host",
      "Couldn’t clone this page — that host is blocked.",
      "Private, local and link-local addresses can’t be cloned. Use a public URL.",
    ],
    [
      422,
      "not_html",
      "Couldn’t clone this page — that address isn’t an HTML page.",
      "PDFs, images and JSON can’t be cloned. Link to the page itself.",
    ],
    [
      413,
      "too_large",
      "Couldn’t clone this page — it’s over 10 MB.",
      "The page and its CSS together have to stay under 10 MB.",
    ],
    [429, "rate_limited", "Too many clone requests.", "Wait a moment, then try again."],
    [
      400,
      "invalid_url",
      "That isn’t a valid web address.",
      "Enter a host and path, like nimbus.app/pricing.",
    ],
  ])("maps %i %s to its own sentence", (status, code, headline, detail) => {
    expect(describeCloneFailure(failure(status, code))).toMatchObject({ headline, detail });
  });

  it("only offers the other-reasons card for failures that are about the page", () => {
    expect(describeCloneFailure(failure(422, "unreachable")).showOtherReasons).toBe(true);
    expect(describeCloneFailure(failure(413, "too_large")).showOtherReasons).toBe(true);
    expect(describeCloneFailure(failure(429, "rate_limited")).showOtherReasons).toBe(true);
    // A malformed address was never a clone attempt.
    expect(describeCloneFailure(failure(400, "invalid_url")).showOtherReasons).toBe(false);
  });

  it("falls back to the status when the code is one the client does not know", () => {
    expect(describeCloneFailure(failure(413, "payload_too_large")).headline).toBe(
      "Couldn’t clone this page — it’s over 10 MB.",
    );
    expect(describeCloneFailure(failure(429, "slow_down")).headline).toBe(
      "Too many clone requests.",
    );
    expect(describeCloneFailure(failure(400, "bad_request")).headline).toBe(
      "That isn’t a valid web address.",
    );
  });

  it("shows the server's own message when neither the code nor the status is known", () => {
    expect(describeCloneFailure(failure(422, "clone_failed", "Renderer crashed"))).toEqual({
      headline: "Couldn’t clone this page.",
      detail: "Renderer crashed",
      showOtherReasons: true,
    });
  });

  it("does not leave the detail empty when the server sends no message", () => {
    expect(describeCloneFailure(failure(422, "clone_failed", "")).detail).toBe(
      "Try another URL, or the same one again in a moment.",
    );
  });

  it("reports a transport failure as a connection problem, not a clone problem", () => {
    const described = describeCloneFailure(new TypeError("Failed to fetch"));

    expect(described).toEqual({
      headline: "Couldn’t reach Vibe Motion.",
      detail: "Check your connection and try again.",
      showOtherReasons: false,
    });
  });
});

describe("isAbortError", () => {
  it("recognises the DOMException an aborted fetch rejects with", () => {
    expect(isAbortError(new DOMException("The operation was aborted.", "AbortError"))).toBe(true);
  });

  it("recognises a plain error named AbortError", () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    expect(isAbortError(error)).toBe(true);
  });

  it("is false for anything else", () => {
    expect(isAbortError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isAbortError(failure(422, "unreachable"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe("entry copy", () => {
  it("keeps the client-side validation message identical to the server's invalid_url", () => {
    expect(INVALID_URL_FAILURE).toEqual(describeCloneFailure(failure(400, "invalid_url")));
  });

  it("lists the handoff's four other reasons a clone can fail", () => {
    expect(OTHER_CLONE_FAILURE_REASONS).toEqual([
      { term: "Unreachable", detail: "DNS or timeout after 15 s" },
      { term: "Too large", detail: "over 10 MB including CSS" },
      { term: "Blocked host", detail: "private or local addresses" },
      { term: "Not HTML", detail: "PDFs, images, JSON" },
    ]);
  });
});
