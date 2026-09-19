/**
 * Where the editor iframe gets a project's cloned page, and which origin the
 * bridge client checks every inbound message against.
 *
 * Real mode: `env.apiOrigin`, which is cross-origin with the shell by
 * construction (two Render services).
 *
 * Mock mode: the same Next server, reached under its *other* loopback name
 * (`lib/loopback.ts`). A service worker only intercepts same-origin
 * navigations, so the iframe cannot be served by MSW; it goes to the Next route
 * `app/mock-api/projects/[projectId]/page/route.ts` instead. Framing that route
 * on this very origin would make mock mode same-origin, and spec §2 is explicit
 * that it must not be: a bridge that skipped its origin check would then pass
 * e2e. So the shell on `localhost:<port>` frames `127.0.0.1:<port>`, and vice
 * versa.
 */
import { env } from "@/lib/env";
import { siblingLoopbackOrigin, type OriginParts } from "@/lib/loopback";

/** What the helpers derive the frame's origin from. `null` means "no browser" (SSR). */
export type PreviewLocation = OriginParts | null;

function currentLocation(): PreviewLocation {
  return typeof window === "undefined" ? null : window.location;
}

/**
 * The iframe's `src`.
 *
 * In mock mode without a loopback sibling — a `window`-less server render, or a
 * dev server reached under some other hostname — this falls back to the
 * relative path, which still loads. It is then same-origin, and
 * {@link previewOrigin} says so, so the client's checks stay consistent with
 * what the browser will actually report.
 */
export function previewPageUrl(
  projectId: string,
  location: PreviewLocation = currentLocation(),
): string {
  if (!env.apiMocking) return `${env.apiOrigin}/projects/${projectId}/page`;
  const path = `/mock-api/projects/${projectId}/page`;
  const sibling = location && siblingLoopbackOrigin(location);
  return sibling ? `${sibling}${path}` : path;
}

/**
 * The origin {@link previewPageUrl} resolves to — the client's `expectedOrigin`
 * and its only outbound `targetOrigin`.
 *
 * Derived *from* the URL rather than computed alongside it, so the two can
 * never disagree; spec §2 defines the shell's check in exactly those terms.
 * `""` while there is no browser: there is no frame to talk to during a server
 * render, and an empty string matches no `event.origin`.
 */
export function previewOrigin(
  projectId: string,
  location: PreviewLocation = currentLocation(),
): string {
  const url = previewPageUrl(projectId, location);
  if (url.startsWith("http://") || url.startsWith("https://")) return new URL(url).origin;
  if (!location) return "";
  return `${location.protocol}//${location.hostname}${location.port ? `:${location.port}` : ""}`;
}
