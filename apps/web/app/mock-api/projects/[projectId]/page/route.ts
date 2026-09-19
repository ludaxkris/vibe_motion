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

  const tag =
    `<script src="${escapeAttribute(BRIDGE_PATH)}" ` +
    `data-vm-parent-origin="${escapeAttribute(shellOrigin)}" defer></script>`;
  // The fixture ends with `</body></html>`; the API inserts at the last
  // `</body`, and one `lastIndexOf` is the same insertion point here.
  const bodyEnd = pageFixtureHtml.lastIndexOf("</body");
  const html =
    bodyEnd < 0
      ? pageFixtureHtml + tag
      : pageFixtureHtml.slice(0, bodyEnd) + tag + pageFixtureHtml.slice(bodyEnd);

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": pagePolicy(shellOrigin),
    },
  });
}
