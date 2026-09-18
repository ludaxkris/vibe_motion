import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * URL entry screen (wireframe).
 *
 * Phase 3 wires the form to `POST /projects` and redirects to `/p/[projectId]`.
 * Until then the submit button is disabled on purpose: nothing here calls the API.
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
          <form className="flex flex-col gap-2">
            <label
              htmlFor="source-url"
              className="text-sm font-medium text-foreground"
            >
              Page URL
            </label>
            <div className="flex gap-2">
              <Input
                id="source-url"
                name="url"
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://example.com"
                aria-describedby="source-url-hint"
                className="flex-1"
              />
              <Button type="submit" disabled>
                Clone page
              </Button>
            </div>
            <p id="source-url-hint" className="text-xs text-muted-foreground">
              Cloning is not wired up yet — it arrives with the API in Phase 2/3.
            </p>
          </form>
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
