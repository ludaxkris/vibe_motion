import { expect, test, type Browser, type Page } from "@playwright/test";

import { stack } from "./env";

/**
 * The Phase 7 exit criterion: a real clone, saved as a real version, exported through the real
 * api, and then **opened as a plain web page with no Vibe Motion anywhere near it**.
 *
 * The three files are served from an origin that has nothing to do with the app or the api, by a
 * Playwright route, so what runs is only what a designer would upload: `index.html`,
 * `vibe-motion.css` and `vibe-motion.js`. No bridge, no iframe, no shell, no CSP of ours.
 *
 * The Export tab is not mounted yet (Track C), so the export is driven through the api. Helpers
 * are local to this file on purpose: `stack/helpers.ts` is being created by another branch.
 */

const FIXTURE_URL = `${stack.fixtureOrigin}/marketing.html`;

/** Unrelated to the web, api and fixture origins: this is somebody else's site. */
const EXPORT_ORIGIN = "http://exported.vm-e2e.test";

/** Small enough that the footer is below the fold without touching the shared fixture page. */
const VIEWPORT = { width: 420, height: 320 };

const LOAD_KEYFRAMES = /^vm-fade-in-up-v\d+-\d+-\d+$/;
const HOVER_KEYFRAMES = /^vm-hover-grow-v\d+-\d+-\d+$/;
const IN_VIEW_KEYFRAMES = /^vm-fade-in-left-v\d+-\d+-\d+$/;

type ExportFile = { name: string; contentType: string };
type ExportBundle = {
  versionId: string;
  mode: string;
  html: string | null;
  css: string;
  js: string | null;
  files: ExportFile[];
};

type Snapshot = { name: string; state: string; time: number } | null;

let bundle: ExportBundle;

// ---------------------------------------------------------------------------
// Building the export: everything below happens once, through the api.
// ---------------------------------------------------------------------------

async function json<T>(page: Page, url: string, init?: RequestInit): Promise<T> {
  return page.evaluate(
    async ({ url, init }) => {
      const response = await fetch(url, init as RequestInit);
      const body = await response.text();
      if (!response.ok) throw new Error(`${response.status} ${url}: ${body}`);
      return JSON.parse(body) as unknown;
    },
    { url, init },
  ) as Promise<T>;
}

/** The `data-vm-id` a real clone gave each element, read off the served page without running it. */
async function vmIdsFor(page: Page, projectId: string, selectors: string[]): Promise<string[]> {
  const ids = await page.evaluate(
    async ({ url, selectors }) => {
      const html = await (await fetch(url)).text();
      // DOMParser never runs a script, so the bridge tag in the served page is inert here.
      const document_ = new DOMParser().parseFromString(html, "text/html");
      return selectors.map((selector) => document_.querySelector(selector)?.getAttribute("data-vm-id") ?? null);
    },
    { url: `${stack.apiOrigin}/projects/${projectId}/page`, selectors },
  );

  for (const [index, id] of ids.entries()) {
    expect(id, `no data-vm-id for ${selectors[index]}`).toMatch(/^vm-\d+$/);
  }
  return ids as string[];
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto("/");

    const project = await json<{ id: string; currentVersionId: string }>(page, `${stack.apiOrigin}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: FIXTURE_URL }),
    });
    const catalog = await json<{ current: string }>(page, `${stack.apiOrigin}/catalog/versions`);
    const [loadId, hoverId, inViewId] = await vmIdsFor(page, project.id, ["#headline", ".cta", "footer small"]);

    const version = catalog.current;
    await json(page, `${stack.apiOrigin}/projects/${project.id}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        parentVersionId: project.currentVersionId,
        catalogVersion: version,
        diff: {
          set: {
            // Long durations so "running" and "paused at 0" are stable assertions, not races.
            [loadId]: {
              animationId: "fade-in-up",
              catalogVersion: version,
              trigger: "load",
              params: { duration: "3000ms", distance: "24px" },
            },
            [hoverId]: {
              // `hover-grow`'s duration is capped at 1000ms by the catalog, unlike the two above.
              animationId: "hover-grow",
              catalogVersion: version,
              trigger: "hover",
              params: { duration: "1000ms", scale: "1.4" },
            },
            [inViewId]: {
              animationId: "fade-in-left",
              catalogVersion: version,
              trigger: "in-view",
              params: { duration: "3000ms", distance: "32px" },
            },
          },
          remove: [],
        },
      }),
    });

    bundle = await json<ExportBundle>(page, `${stack.apiOrigin}/projects/${project.id}/export`);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// Opening it as an ordinary page on somebody else's origin.
// ---------------------------------------------------------------------------

async function openExport(
  browser: Browser,
  options: { reducedMotion?: "reduce" | "no-preference"; javaScriptEnabled?: boolean } = {},
): Promise<Page> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    reducedMotion: options.reducedMotion ?? "no-preference",
    javaScriptEnabled: options.javaScriptEnabled ?? true,
  });
  const page = await context.newPage();

  await page.route(`${EXPORT_ORIGIN}/index.html`, (route) =>
    route.fulfill({ contentType: "text/html", body: bundle.html ?? "" }),
  );
  await page.route(`${EXPORT_ORIGIN}/vibe-motion.css`, (route) =>
    route.fulfill({ contentType: "text/css", body: bundle.css }),
  );
  await page.route(`${EXPORT_ORIGIN}/vibe-motion.js`, (route) =>
    route.fulfill({ contentType: "text/javascript", body: bundle.js ?? "" }),
  );
  // The fixture's own stylesheet and image came through the clone as absolute URLs on the fixture
  // origin, which the stack can still reach. Nothing else is routed: if the page asked for
  // anything of ours, it would simply fail to load, which is the point.

  await page.addInitScript(() => {
    (window as unknown as { __starts: Record<string, number> }).__starts = {};
    document.addEventListener(
      "animationstart",
      (event) => {
        const counts = (window as unknown as { __starts: Record<string, number> }).__starts;
        const name = (event as AnimationEvent).animationName;
        counts[name] = (counts[name] ?? 0) + 1;
      },
      true,
    );
  });

  await page.goto(`${EXPORT_ORIGIN}/index.html`);
  return page;
}

function animationOf(page: Page, selector: string): Promise<Snapshot> {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    const animation = element?.getAnimations()[0];
    if (!animation) return null;
    return {
      name: (animation as CSSAnimation).animationName ?? "",
      state: animation.playState,
      time: Math.round(Number(animation.currentTime ?? 0)),
    };
  }, selector);
}

function starts(page: Page, pattern: RegExp): Promise<number> {
  return page.evaluate((source) => {
    const counts = (window as unknown as { __starts: Record<string, number> }).__starts ?? {};
    const re = new RegExp(source);
    return Object.entries(counts)
      .filter(([name]) => re.test(name))
      .reduce((total, [, count]) => total + count, 0);
  }, pattern.source);
}

test.describe.configure({ mode: "serial" });

test("the export is a self-contained page with no Vibe Motion machinery in it", async ({ browser }) => {
  const page = await openExport(browser);

  expect(bundle.files.map((file) => file.name)).toEqual(["index.html", "vibe-motion.css", "vibe-motion.js"]);
  await expect(page.locator("[data-vm-id]")).toHaveCount(0);
  await expect(page.locator("[data-vm-overlay]")).toHaveCount(0);
  expect(await page.locator("script").count()).toBe(1);
  expect(await page.locator("script").getAttribute("src")).toBe("vibe-motion.js");
  // The gate class is what makes the in-view rules apply at all.
  await expect(page.locator("html")).toHaveClass(/vm-js/);

  await page.context().close();
});

test("a load assignment runs as soon as the page opens", async ({ browser }) => {
  const page = await openExport(browser);

  const running = await animationOf(page, "#headline");
  expect(running?.name).toMatch(LOAD_KEYFRAMES);
  expect(running?.state).toBe("running");

  await page.context().close();
});

test("an in-view element below the fold is held at time 0 and plays once, when it is reached", async ({
  browser,
}) => {
  const page = await openExport(browser);
  const target = page.locator("footer small");

  // Not a vacuous test: the element really is off screen at this viewport.
  const box = await target.boundingBox();
  expect(box?.y ?? 0).toBeGreaterThan(VIEWPORT.height);

  const held = await animationOf(page, "footer small");
  expect(held?.name).toMatch(IN_VIEW_KEYFRAMES);
  expect(held?.state).toBe("paused");
  expect(held?.time).toBe(0);

  await target.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await animationOf(page, "footer small"))?.state).toBe("running");
  expect(await starts(page, IN_VIEW_KEYFRAMES)).toBe(1);

  // Away and back: it was unobserved when it fired, so it never replays.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  expect(await starts(page, IN_VIEW_KEYFRAMES)).toBe(1);

  await page.context().close();
});

test("a hover assignment animates only while the pointer is on it, with no JavaScript involved", async ({
  browser,
}) => {
  const page = await openExport(browser);

  // At rest the element has no animation at all: the `animation` declaration is only in the
  // `:hover` rule, and nothing is holding or filling it.
  expect(await animationOf(page, ".cta")).toBeNull();

  await page.locator(".cta").hover();
  // `animationstart`, not a playState read: a 1 s animation could legitimately have finished by
  // the time the assertion runs, and "it started exactly once" is the real claim.
  await expect.poll(async () => await starts(page, HOVER_KEYFRAMES)).toBe(1);
  expect((await animationOf(page, ".cta"))?.name).toMatch(HOVER_KEYFRAMES);

  await page.mouse.move(0, 0);
  await expect.poll(async () => await animationOf(page, ".cta")).toBeNull();

  await page.context().close();
});

test("a reader who asks for less motion gets the page untouched, with the in-view element visible", async ({
  browser,
}) => {
  const page = await openExport(browser, { reducedMotion: "reduce" });

  for (const selector of ["#headline", ".cta", "footer small"]) {
    expect(await animationOf(page, selector), selector).toBeNull();
  }
  await page.locator(".cta").hover();
  expect(await animationOf(page, ".cta")).toBeNull();

  // Nothing is left hidden on a first keyframe of `opacity: 0`.
  await expect(page.locator("footer small")).toBeVisible();
  expect(await page.locator("footer small").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

  await page.context().close();
});

test("with JavaScript off, the in-view element is visible and at rest", async ({ browser }) => {
  const page = await openExport(browser, { javaScriptEnabled: false });

  await expect(page.locator("html")).not.toHaveClass(/vm-js/);
  await expect(page.locator("footer small")).toBeVisible();
  expect(await page.locator("footer small").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  expect(await page.locator("footer small").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");

  // The rules that need no JavaScript still work.
  expect(await page.locator("#headline").evaluate((el) => getComputedStyle(el).animationName)).toMatch(
    /^vm-fade-in-up-v/,
  );

  await page.context().close();
});
