import { expect, test, type Page } from "@playwright/test";

import { stack } from "./env";

/**
 * Full stack: browser on the web origin → real api image → Postgres, cloning a fixture page
 * through the unmodified SSRF guard. These drive the api from page context on purpose, so every
 * request is a real cross-origin browser request (CORS included). UI-driven flows replace the
 * `fetch` calls as Phases 3 and 4 land; the stack does not change.
 */

type Project = { id: string; sourceUrl: string; title: string; currentVersionId: string };

async function createProject(page: Page, url: string) {
  return page.evaluate(
    async ({ apiOrigin, url }) => {
      const res = await fetch(`${apiOrigin}/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      return { status: res.status, body: await res.json() };
    },
    { apiOrigin: stack.apiOrigin, url },
  );
}

test("the api is up with a migrated database", async ({ request }) => {
  const res = await request.get(`${stack.apiOrigin}/health`);

  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: "ok", db: "ok" });
});

test("the web origin may call the api; a foreign origin may not", async ({ page, request }) => {
  await page.goto("/");

  const fromWeb = await page.evaluate(async (apiOrigin) => {
    const res = await fetch(`${apiOrigin}/catalog/versions`);
    return { status: res.status, body: await res.json() };
  }, stack.apiOrigin);
  expect(fromWeb.status).toBe(200);
  expect(fromWeb.body.versions).toContain(fromWeb.body.current);

  const foreign = await request.get(`${stack.apiOrigin}/catalog/versions`, {
    headers: { Origin: "https://evil.example" },
  });
  expect(foreign.status()).toBe(403);
  expect(foreign.headers()["access-control-allow-origin"]).toBeUndefined();
});

test("cloning a fixture page creates a project and serves an instrumented, script-free copy", async ({ page }) => {
  await page.goto("/");

  const created = await createProject(page, `${stack.fixtureOrigin}/marketing.html`);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const project = created.body as Project;
  expect(project.title).toContain("Acme");
  expect(project.currentVersionId).toBeTruthy();

  // Host the clone the way the editor will: an iframe on the web origin pointing at the api.
  const ready = page.evaluate(
    ({ src, apiOrigin }) =>
      new Promise<{ type: string; elementCount: number }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("bridge never posted ready")), 15_000);
        window.addEventListener("message", (event) => {
          if (event.origin !== apiOrigin || event.data?.source !== "vibe-motion") return;
          if (event.data.type !== "ready") return; // Phase 4 adds more message types
          clearTimeout(timer);
          resolve({ type: event.data.type, elementCount: event.data.payload.elementCount });
        });
        const frame = document.createElement("iframe");
        frame.id = "vm-e2e-preview";
        frame.src = src;
        document.body.append(frame);
      }),
    { src: `${stack.apiOrigin}/projects/${project.id}/page`, apiOrigin: stack.apiOrigin },
  );

  const message = await ready;
  expect(message.type).toBe("ready");
  expect(message.elementCount).toBeGreaterThan(10);

  const clone = page.frameLocator("#vm-e2e-preview");
  await expect(clone.locator("#headline")).toHaveText("Ship motion, not tickets");
  await expect(clone.locator("#headline")).toHaveAttribute("data-vm-id", /.+/);
  // The page's own script was stripped at clone time…
  await expect(clone.locator("html")).not.toHaveAttribute("data-fixture-script-ran", "yes");
  // …and its linked stylesheet was fetched through the guard and still applies.
  await expect(clone.locator(".cta")).toHaveCSS("background-color", "rgb(20, 33, 61)");
});

// The stack's own network sits on a range the guard allows (that is how fixtures are clonable),
// so this proves the guard itself is live in the image under test, not that the stack is sealed.
test("the SSRF guard still refuses private, loopback and metadata targets", async ({ page }) => {
  await page.goto("/");

  for (const url of ["http://10.0.0.5/", "http://127.0.0.1:8080/health", "http://localhost:8080/health", "http://169.254.169.254/latest/meta-data/"]) {
    const res = await createProject(page, url);
    expect(res.status, `${url} → ${JSON.stringify(res.body)}`).toBe(422);
    // 422 alone proves nothing: without the guard these would still 422 as unreachable / not html.
    expect(res.body.code, url).toBe("url_blocked");
  }
});
