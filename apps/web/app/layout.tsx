import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vibe Motion",
  description:
    "Add CSS animations to an existing web page: clone it, click a component, tune the motion, version it, export it.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <Providers>
          <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Vibe Motion
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/help" className="hover:text-foreground">
                Animation catalog
              </Link>
            </nav>
          </header>
          <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
