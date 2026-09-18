import { EntryScreen } from "@/components/entry/entry-screen";

/**
 * URL entry screen.
 *
 * Server Component shell; `EntryScreen` is the client boundary that submits
 * `POST /projects` and redirects into the editor at `/p/[projectId]`. It owns
 * the screen's own chrome — the top bar is a banner and therefore cannot live
 * inside the page's `<main>`, so neither is in `app/layout.tsx`.
 */
export default function Home() {
  return <EntryScreen />;
}
