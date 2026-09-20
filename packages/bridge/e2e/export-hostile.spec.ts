import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { EXPORT_ORIGIN } from "./harness";

/**
 * The real-browser gate for exported HTML.
 *
 * **jsoup is not an oracle for how a browser parses.** The exporter re-parses and re-sanitises
 * `base_html` with jsoup, and the Kotlin tests then re-parse the *output* with jsoup again — which
 * proves only what jsoup sees in it. A parser differential, markup jsoup serialises one way and a
 * browser reads another, is invisible from there: one such document (a nested `<form>` that shifts
 * a `<style>` into MathML, where it is not a raw-text element) was exported as inert-looking bytes
 * and executed in Chromium.
 *
 * So the claim "an exported page is inert" is proven here, in a browser, over the whole corpus.
 * The inputs live in `apps/api/src/test/resources/export/hostile/`; `HostileCorpusTest` exports
 * each one into the goldens this spec reads, so the two halves cannot drift.
 *
 * Every fixture is inert by construction: its payloads set `window.__vmExecuted` and nothing else.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(here, "..", "..", "..", "apps", "api", "src", "test", "resources", "golden", "export", "hostile");

const goldens = readdirSync(GOLDEN_DIR)
  .filter((name) => name.endsWith(".html"))
  .sort();

type Watch = {
  dialogs: string[];
  foreignRequests: string[];
  navigations: string[];
};

/** Serve one exported document on an origin of its own, and watch everything it tries to do. */
async function openExported(page: Page, name: string): Promise<Watch> {
  const watch: Watch = { dialogs: [], foreignRequests: [], navigations: [] };
  const url = `${EXPORT_ORIGIN}/${name}`;

  page.on("dialog", (dialog) => {
    watch.dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame() && frame.url() !== url && frame.url() !== "about:blank") {
      watch.navigations.push(frame.url());
    }
  });
  page.on("request", (request) => {
    if (!request.url().startsWith(EXPORT_ORIGIN)) watch.foreignRequests.push(request.url());
  });

  // Registered widest first: Playwright tries the most recently added route first, so the
  // document wins over the origin catch-all, which wins over the global refusal.
  await page.route("**/*", (route) => route.abort());
  // Everything else on this origin — the fixtures' `<img src=x>` and our own `vibe-motion.css` —
  // answers 200 with nothing, so an `onerror` handler that survived would certainly fire.
  await page.route(`${EXPORT_ORIGIN}/**`, (route) => route.fulfill({ status: 200, body: "" }));
  await page.route(`${EXPORT_ORIGIN}/${name}`, (route) =>
    route.fulfill({ contentType: "text/html", body: readFileSync(path.join(GOLDEN_DIR, name), "utf8") }),
  );

  await page.goto(url);
  // Give a deferred handler, an image error and a microtask somewhere to happen.
  await page.waitForTimeout(150);

  return watch;
}

test.describe("exported hostile documents are inert in a real browser", () => {
  test("the corpus is present and covers the parser-differential document", () => {
    expect(goldens.length).toBeGreaterThan(10);
    expect(goldens).toContain("nested-form-mathml-style.html");
  });

  for (const name of goldens) {
    test(name, async ({ page }) => {
      const watch = await openExported(page, name);

      // 1. Nothing ran. Every payload in the corpus sets this and only this.
      expect(await page.evaluate(() => (window as unknown as { __vmExecuted?: boolean }).__vmExecuted)).toBeUndefined();

      // 2. Nothing asked the user anything.
      expect(watch.dialogs).toEqual([]);

      // 3. Nothing took the reader somewhere else.
      expect(watch.navigations).toEqual([]);

      // 4. Nothing phoned home. A cloned page's own assets are already absolute at clone time, so
      //    a request off this origin from an exported document is something we put there.
      expect(watch.foreignRequests).toEqual([]);

      // 5. The browser's own DOM — not jsoup's idea of it — has nothing live in it. This is the
      //    assertion the Kotlin side structurally cannot make: an element the browser built out of
      //    text jsoup thought was raw shows up here and nowhere else.
      const live = await page.evaluate(() => {
        const handlers: string[] = [];
        const scripts: string[] = [];
        for (const element of Array.from(document.querySelectorAll("*"))) {
          for (const attribute of Array.from(element.attributes)) {
            if (/^on/i.test(attribute.name)) handlers.push(`${element.tagName}[${attribute.name}]`);
          }
          if (element.tagName.toLowerCase() === "script") scripts.push(element.getAttribute("src") ?? "inline");
        }
        return { handlers, scripts };
      });

      expect(live.handlers).toEqual([]);
      expect(live.scripts.filter((src) => src !== "vibe-motion.js")).toEqual([]);
    });
  }
});
