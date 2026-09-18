import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { pageFixtureHtml } from "@/mocks/fixtures/page";

/**
 * Same-origin stand-in for `GET /projects/{id}/page`, used as the editor
 * iframe `src` only when `env.apiMocking` is true (see `lib/preview-url.ts`).
 * A service worker cannot intercept the iframe's cross-origin navigation to
 * the real API's origin, so mocking routes the iframe here instead.
 *
 * 404s whenever mocking is off — this route must never serve real data.
 * Unlike the MSW handler, an unknown `projectId` still returns the fixture
 * (this route has no access to the mock in-memory store, which lives in the
 * browser's service worker realm, not the server).
 */
export const dynamic = "force-dynamic";

export function GET() {
  if (!env.apiMocking) {
    return new NextResponse(null, { status: 404 });
  }
  return new NextResponse(pageFixtureHtml, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
