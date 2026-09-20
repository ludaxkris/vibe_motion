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

/** What the browser actually built, as opposed to what jsoup thought it was writing. */
type LiveDom = {
  handlers: string[];
  scripts: string[];
  schemeValues: string[];
  dangerousElements: string[];
  metaRefresh: number;
};

/** Everything a page could do that an exported page must not. */
async function inspect(page: Page): Promise<LiveDom> {
  return page.evaluate(() => {
    const handlers: string[] = [];
    const scripts: string[] = [];
    const schemeValues: string[] = [];
    const dangerousElements: string[] = [];
    let metaRefresh = 0;

    // `java\nscript:` navigates, and so does a leading control character, so the value is read
    // the way a browser reads it: whitespace and controls stripped, then lower-cased.
    const scheme = (value: string) =>
      value
        .split("")
        .filter((character) => character.charCodeAt(0) > 0x20 && character.charCodeAt(0) !== 0x7f)
        .join("")
        .toLowerCase();

    for (const element of Array.from(document.querySelectorAll("*"))) {
      const tag = element.tagName.toLowerCase();
      if (tag === "script") scripts.push(element.getAttribute("src") ?? "inline");
      if (["iframe", "object", "embed", "base", "frame", "applet"].includes(tag)) dangerousElements.push(tag);
      if (tag === "meta" && element.hasAttribute("http-equiv")) {
        dangerousElements.push(`meta[${element.getAttribute("http-equiv")}]`);
        if ((element.getAttribute("http-equiv") ?? "").trim().toLowerCase() === "refresh") metaRefresh += 1;
      }
      for (const attribute of Array.from(element.attributes)) {
        if (/^on/i.test(attribute.name)) handlers.push(`${element.tagName}[${attribute.name}]`);
        const value = scheme(attribute.value);
        if (value.startsWith("javascript:") || value.startsWith("vbscript:") || value.startsWith("data:text/html")) {
          schemeValues.push(`${element.tagName}[${attribute.name}]`);
        }
      }
    }

    return { handlers, scripts, schemeValues, dangerousElements, metaRefresh };
  });
}

/** Serve one document on an origin of its own, and watch everything it tries to do. */
async function openDocument(page: Page, name: string, body: string): Promise<Watch> {
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
  await page.route(`${EXPORT_ORIGIN}/${name}`, (route) => route.fulfill({ contentType: "text/html", body }));

  await page.goto(url);
  // Give a deferred handler, an image error and a microtask somewhere to happen. A *delayed* meta
  // refresh would outlive this wait, which is why the DOM sweep asserts there is no
  // `meta[http-equiv]` at all rather than waiting long enough to watch one fire.
  await page.waitForTimeout(150);

  return watch;
}

const openExported = (page: Page, name: string) =>
  openDocument(page, name, readFileSync(path.join(GOLDEN_DIR, name), "utf8"));

test.describe("exported hostile documents are inert in a real browser", () => {
  test("the corpus is present and covers the parser-differential document", () => {
    expect(goldens.length).toBeGreaterThan(10);
    expect(goldens).toContain("nested-form-mathml-style.html");
    expect(goldens).toContain("icon-style.html");
  });

  test("the detector detects: an unsanitised control document trips every check", async ({ page }) => {
    // Without this, a spec that served the wrong body — an empty response, a 404 page, the same
    // document every time — would report every export as inert and prove nothing. The control is
    // not an export and has never been through the sanitiser; it lives beside this spec so it can
    // never be mistaken for one.
    const control = readFileSync(path.join(here, "control-unsanitised.html"), "utf8");

    await openDocument(page, "control-unsanitised.html", control);
    const live = await inspect(page);

    // One assertion per check the loop below makes, so none of them can quietly become dead code.
    expect(await page.evaluate(() => (window as unknown as { __vmExecuted?: boolean }).__vmExecuted)).toBe(true);
    expect(live.handlers).toContain("IMG[onerror]");
    expect(live.schemeValues).toContain("A[href]");
    expect(live.dangerousElements).toContain("iframe");
    expect(live.metaRefresh).toBe(1);
  });

  test("a benign inline icon's own stylesheet still applies", async ({ page }) => {
    // The other half of the claim. Dropping every `<svg><style>` would keep the corpus inert and
    // quietly unstyle real pages, so the narrow keep is proved the same way the removals are: in
    // a browser. This also settles the escaping question — jsoup writes `svg &gt; circle`, and
    // only a real parse says whether the selector still matches.
    await openExported(page, "icon-style.html");

    const style = await page.locator("#dot").evaluate((element) => {
      const computed = getComputedStyle(element);
      return { fill: computed.fill, stroke: computed.stroke };
    });

    expect(style.fill).toBe("rgb(0, 128, 0)");
    expect(style.stroke).toBe("rgb(0, 0, 255)");
  });

  test("a CDATA-wrapped icon stylesheet — what Illustrator exports — still applies", async ({ page }) => {
    // The section is rewritten as escaped text by the sanitiser, which is inert in every reading;
    // this is the half that proves it still *renders*.
    await openExported(page, "icon-style-cdata.html");

    const style = await page.locator("#dot").evaluate((element) => {
      const computed = getComputedStyle(element);
      return { fill: computed.fill, stroke: computed.stroke };
    });

    expect(style.fill).toBe("rgb(128, 0, 128)");
    expect(style.stroke).toBe("rgb(255, 0, 0)");
  });

  test("a style whose nearest svg ancestor is inside a foreignObject still applies", async ({ page }) => {
    // `foreignContext()` walks to the nearest foreign root, so this block is kept. The wording in
    // the KDoc, architecture.md and HostileCorpusTest says so; this is the shape that tests it.
    await openExported(page, "svg-foreignobject-nested-svg.html");

    expect(await page.locator("#dot").evaluate((element) => getComputedStyle(element).fill)).toBe("rgb(0, 128, 128)");
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
      const live = await inspect(page);

      expect(live.handlers).toEqual([]);
      expect(live.scripts.filter((src) => src !== "vibe-motion.js")).toEqual([]);
      expect(live.schemeValues).toEqual([]);
      // An `<iframe srcdoc>` would set the marker on its own window rather than this one, and a
      // `meta refresh` with a delay longer than the settle wait would never register as a
      // navigation. Neither has any business existing in an export, so neither is waited for.
      expect(live.dangerousElements).toEqual([]);
      expect(live.metaRefresh).toBe(0);
    });
  }
});
