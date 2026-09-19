import Link from "next/link";

import { TopBar } from "@/components/top-bar";

/**
 * 404 — an unmatched route, and what `notFound()` renders (`/dev/panel` calls
 * it in production).
 *
 * Carries its own chrome for the same reason every other screen does: the top
 * bar is a `banner`, so it cannot sit inside the page's `<main>`, and
 * `app/layout.tsx` provides neither.
 */
export default function NotFound() {
  return (
    <>
      <TopBar />
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-[120px] pb-[60px] text-center">
        <h1 className="text-lg font-semibold">That page doesn’t exist.</h1>
        <p className="text-md text-vm-ink-2">
          The link may be old, or the project may have been deleted.
        </p>
        <Link
          href="/"
          className="text-sm font-medium text-vm-accent transition-colors duration-(--dur-fast) ease-standard hover:text-vm-accent-hover"
        >
          Start a new project
        </Link>
      </main>
    </>
  );
}
