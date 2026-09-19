/**
 * URL the editor iframe uses as its `src` for a project's cloned page.
 *
 * The iframe's `src` normally points at `env.apiOrigin` (the real API), but a
 * service worker only intercepts same-origin navigations — it cannot intercept
 * the iframe's cross-origin request to `http://localhost:8080`. When mocking is
 * on, this instead points at a same-origin Next route
 * (`app/mock-api/projects/[projectId]/page/route.ts`) that serves the same
 * fixture the MSW handlers do.
 */
import { env } from "@/lib/env";

export function previewPageUrl(projectId: string): string {
  return env.apiMocking
    ? `/mock-api/projects/${projectId}/page`
    : `${env.apiOrigin}/projects/${projectId}/page`;
}
