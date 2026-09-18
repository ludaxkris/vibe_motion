import { NextResponse } from "next/server";

/** Render's health check for the `web` service. Must stay dependency-free and uncached. */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" });
}
