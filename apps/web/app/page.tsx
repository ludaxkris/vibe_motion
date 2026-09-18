import Link from "next/link";

import { UrlEntryForm } from "@/components/url-entry-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * URL entry screen.
 *
 * Server Component shell; `UrlEntryForm` is the client boundary that submits
 * `POST /projects` and redirects into the editor at `/p/[projectId]`.
 */
export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="text-2xl">
            {/* CardTitle renders a div; the page still needs a real heading. */}
            <h1>Add motion to a page</h1>
          </CardTitle>
          <CardDescription>
            Paste the URL of a public page. Vibe Motion clones it, you click a
            component, pick an animation, and tune it live.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <UrlEntryForm />
          <p className="text-sm text-muted-foreground">
            Curious what you can apply?{" "}
            <Link href="/help" className="underline underline-offset-4">
              Browse the animation catalog
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
