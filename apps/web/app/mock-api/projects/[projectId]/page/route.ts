import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { siblingLoopbackOrigin } from "@/lib/loopback";
import { pageFixtureHtml } from "@/mocks/fixtures/page";
import { pagePolicy } from "@/mocks/page-csp";

/**
 * Mock-mode stand-in for `GET /projects/{id}/page`, used as the editor iframe
 * `src` only when `env.apiMocking` is true (see `lib/preview-url.ts`). A
 * service worker cannot intercept the iframe's cross-origin navigation to the
 * real API's origin, so mocking routes the iframe here instead.
 *
 * Like the API's `BridgePageRenderer`, this injects the bridge tag and sends
 * the policy at *serve* time rather than storing either: the fixture stays a
 * plain page, and the bridge the mock serves is always the current one.
 *
 * The shell is on this machine's *other* loopback name (`lib/loopback.ts`), so
 * the frame is genuinely cross-origin with it (spec §2) and the parent origin
 * below is a real origin check rather than a formality.
 *
 * 404s whenever mocking is off — this route must never serve real data.
 * Unlike the MSW handler, an unknown `projectId` still returns the fixture
 * (this route has no access to the mock in-memory store, which lives in the
 * browser's service worker realm, not the server).
 */
export const dynamic = "force-dynamic";

/** Where the mock serves the script; the API uses `/bridge/vm-bridge.js`. */
const BRIDGE_PATH = "/mock-api/bridge/vm-bridge.js";

/**
 * `?vmExtraElements=N` appends N more tagged paragraphs.
 *
 * Only the performance spec asks for it (spec §6 budgets `state:load` at 200
 * assignments, and the fixture has twelve elements). A real clone is whatever
 * size the page was, so this is the mock standing in for a big one rather than
 * a second fixture to keep in step. Capped so a stray value cannot make the
 * dev server build a megabyte of markup.
 */
const MAX_EXTRA_ELEMENTS = 1000;

function extraElements(count: number): string {
  let html = "";
  for (let index = 1; index <= count; index += 1) {
    html += `<p data-vm-id="vm-extra-${index}">Filler element ${index}.</p>`;
  }
  return html;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The origin the browser actually asked for, from the `Host` header.
 *
 * Not `request.url`: `NextRequest` rewrites a `127.0.0.1` authority to
 * `localhost`, which would make this route hand the frame *its own* origin as
 * the parent origin — a bridge that then silently ignored every message from
 * the shell. The header is what the browser sent and is not normalised.
 */
function servedOrigin(request: NextRequest): URL {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  return host ? new URL(`${url.protocol}//${host}`) : url;
}

export function GET(request: NextRequest): NextResponse {
  if (!env.apiMocking) {
    return new NextResponse(null, { status: 404 });
  }

  // Derived from the request, not from a constant: the shell is whichever
  // loopback name this response is *not* being served under, on whatever port
  // the dev server got.
  const url = servedOrigin(request);
  const shellOrigin = siblingLoopbackOrigin(url) ?? url.origin;

  const requested = Number(new URL(request.url).searchParams.get("vmExtraElements") ?? 0);
  const extra = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 0), MAX_EXTRA_ELEMENTS)
    : 0;

  const tag =
    `<script src="${escapeAttribute(BRIDGE_PATH)}" ` +
    `data-vm-parent-origin="${escapeAttribute(shellOrigin)}" defer></script>`;
  // The fixture ends with `</body></html>`; the API inserts at the last
  // `</body`, and one `lastIndexOf` is the same insertion point here.
  const bodyEnd = pageFixtureHtml.lastIndexOf("</body");
  const inserted = extraElements(extra) + tag;
  const html =
    bodyEnd < 0
      ? pageFixtureHtml + inserted
      : pageFixtureHtml.slice(0, bodyEnd) + inserted + pageFixtureHtml.slice(bodyEnd);

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": pagePolicy(shellOrigin),
    },
  });
}
