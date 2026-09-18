import type { Metadata } from "next";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vibe Motion",
  description:
    "Add CSS animations to an existing web page: clone it, click a component, tune the motion, version it, export it.",
};

/**
 * Root layout.
 *
 * Deliberately chrome-free: the handoff's 44px `TopBar` is part of each screen
 * (its context and actions differ per screen), not a shared shell. No
 * `next/font` either — the handoff's type is the system stack from
 * `--font-sans` / `--font-mono`, with no webfont to load.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <Providers>
          <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
