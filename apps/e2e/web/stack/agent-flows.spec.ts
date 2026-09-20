import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  cloneFixture,
  inline,
  installMessageRecorder,
  preview,
  receivedTypes,
  watchVersionPosts,
} from "./helpers";

/**
 * Phase 5's three flows on the real stack: generate for one element, choose a
 * custom animation and tune it, and auto-generate for the page with its result
 * list (plan `docs/plans/phase-5-agent-flows.md`, Task 6).
 *
 * The app seeds the mock agent from `Date.now()` (plan D7) and a production
 * build has no test seed channel, so nothing here asserts a specific pick.
 * Every assertion is an invariant of the heuristics (D6): categories, triggers,
 * the stagger, never an exit.
 *
 * Every test ends on the build plan's exit criteria for the phase: the run
 * filled the client-side draft only, so no version was POSTed and the unsaved
 * indicator shows (CLAUDE.md rule 9).
 */

// Read from the package's files, not imported: Playwright loads specs as
// CommonJS and `animation-catalog` is ESM-only (see `../smoke.spec.ts`).
type CatalogEntry = {
  id: string;
  name: string;
  category: string;
  params: { key: string; default: string }[];
};
const CATALOG_DIR = path.resolve(__dirname, "../../../../packages/animation-catalog");
const CURRENT_VERSION = readFileSync(path.join(CATALOG_DIR, "current"), "utf8").trim();
const ENTRIES: CatalogEntry[] = JSON.parse(
  readFileSync(path.join(CATALOG_DIR, "versions", `${CURRENT_VERSION}.json`), "utf8"),
).entries;
const ENTRY_BY_NAME = new Map(ENTRIES.map((entry) => [entry.name, entry]));

const KEYFRAMES = /^vm-.+-v\d+-\d+-\d+$/;
/** Phase 4's `BULK_APPLY_LIMIT`: more changes than this in one flush go out as one `state:load`. */
const BULK_APPLY_LIMIT = 8;
const STAGGER_MS = 60;
const STAGGER_CAP_MS = 600;
const PROMPT = "calm, staggered entrances, nothing loops";

type Row = {
  vmId: string;
  tag: string;
  entry: CatalogEntry;
  trigger: string;
  duration: string;
  delay: string;
  edited: boolean;
};

function defaultOf(entry: CatalogEntry, key: string): string | undefined {
  return entry.params.find((param) => param.key === key)?.default;
}

/** The result list as the designer reads it, in list order. */
async function readRows(page: Page): Promise<Row[]> {
  const rows = page.getByTestId("auto-result-row");
  const raw = await rows.evaluateAll((buttons) =>
    buttons.map((button) => ({
      label: button.getAttribute("aria-label") ?? "",
      meta: button.querySelector('[data-testid="auto-result-row-meta"]')?.textContent ?? "",
      text: button.textContent ?? "",
    })),
  );
  return raw.map(({ label, meta, text }) => {
    const match = /^Tune (.+) on (\S+) \((vm-[a-z0-9-]+)\)$/.exec(label);
    if (!match) throw new Error(`unexpected row label: ${label}`);
    const [, name, tag, vmId] = match as unknown as [string, string, string, string];
    const entry = ENTRY_BY_NAME.get(name);
    if (!entry) throw new Error(`row names an animation the catalog does not have: ${name}`);
    const [trigger = "", duration = "", delay = ""] = meta.split(" · ");
    return { vmId, tag, entry, trigger, duration, delay, edited: /edited/.test(text) };
  });
}

function row(page: Page, vmId: string) {
  return page.locator(`[data-testid="auto-result-row"][aria-label$="(${vmId})"]`);
}

function element(page: Page, vmId: string) {
  return preview(page).locator(`[data-vm-id="${vmId}"]`);
}

async function vmIdOf(page: Page, selector: string): Promise<string> {
  const vmId = await preview(page).locator(selector).getAttribute("data-vm-id");
  expect(vmId, selector).toMatch(/^vm-\d+$/);
  return vmId as string;
}

/**
 * The shell has stopped talking to the frame. The iframe's `load` event makes
 * the shell send a second `hello`, whose `ready` triggers a fresh `state:load`
 * and rejects anything pending (protocol spec D7); a run started before that
 * would be counted wrongly, or fail with "Couldn't read the page".
 */
async function bridgeSettled(page: Page) {
  await expect
    .poll(() => preview(page).locator("html").evaluate(() => document.readyState))
    .toBe("complete");
  await expect(async () => {
    const before = (await receivedTypes(page)).length;
    await page.waitForTimeout(300);
    expect((await receivedTypes(page)).length).toBe(before);
  }).toPass();
}

/** Types the prompt, runs Auto-generate, and returns what the frame received because of it. */
async function autoGenerate(page: Page): Promise<{ rows: Row[]; received: () => Promise<string[]> }> {
  await bridgeSettled(page);
  const baseline = (await receivedTypes(page)).length;
  const received = async () => (await receivedTypes(page)).slice(baseline);

  await expect(page.getByTestId("panel-idle")).toBeVisible();
  await page.getByLabel("Describe the feel").fill(PROMPT);
  await page.getByRole("button", { name: "Auto-generate for this page" }).click();

  await expect(page.getByTestId("agent-run-error")).toHaveCount(0);
  await expect(page.getByTestId("panel-auto-result")).toBeVisible();
  // The draft reaches the frame at the subscriber's next rAF flush.
  await expect.poll(async () => (await received()).includes("state:load")).toBe(true);

  return { rows: await readRows(page), received };
}

async function setDuration(page: Page, ms: number) {
  const duration = page.getByRole("spinbutton", { name: "Duration value" });
  await duration.fill(String(ms));
  await duration.press("Enter");
}

test.beforeEach(async ({ page }) => {
  // Before navigation: the recorder is an init script for the framed document.
  await installMessageRecorder(page);
});

test("generate for one element lands in tuning with an animation running in the frame", async ({
  page,
}) => {
  const versionPosts = watchVersionPosts(page);
  await cloneFixture(page);

  const headline = preview(page).locator("h1");
  const vmId = await vmIdOf(page, "h1");
  await headline.click();
  await expect(page.getByTestId("panel-selected")).toBeVisible();

  await page.getByRole("button", { name: "Auto-generate for this element" }).click();

  const tuning = page.getByTestId("panel-tuning");
  await expect(tuning).toBeVisible();
  await expect(tuning.getByText(vmId, { exact: true })).toBeVisible();
  // Not opened from the result list, so there is no list to go back to.
  await expect(tuning.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);

  // With no page run the fold is unknown, which means `load` (armed at once).
  await expect.poll(() => inline(headline, "animation-name")).toMatch(KEYFRAMES);

  expect(versionPosts()).toBe(0);
  await expect(page.getByTestId("unsaved-indicator")).toBeVisible();
});

test("choose custom, pick and tune: the new duration reaches the element", async ({ page }) => {
  const versionPosts = watchVersionPosts(page);
  await cloneFixture(page);

  // The top-level logo; the fixture has a second img inside a <figure>.
  const logo = preview(page).locator("main > img");
  await logo.click();
  await expect(page.getByTestId("panel-selected")).toBeVisible();

  await page.getByRole("button", { name: "Choose custom animation" }).click();
  await page.getByRole("button", { name: "Fade In Up", exact: true }).click();
  await expect(page.getByTestId("panel-tuning")).toBeVisible();
  await expect.poll(() => inline(logo, "animation-name")).toMatch(/^vm-fade-in-up-v\d+-\d+-\d+$/);

  await setDuration(page, 900);
  await expect.poll(() => inline(logo, "animation-duration")).toBe("900ms");

  expect(versionPosts()).toBe(0);
  await expect(page.getByTestId("unsaved-indicator")).toBeVisible();
});

test("auto-generate fills the page by the heuristics and sends it to the frame as one state:load", async ({
  page,
}) => {
  const versionPosts = watchVersionPosts(page);
  await cloneFixture(page);

  const ctaId = await vmIdOf(page, ".cta");
  const belowFoldId = await vmIdOf(page, "#below-fold");
  const headlineId = await vmIdOf(page, "h1");

  // At rest, before anything animates it: a mid-animation box is the transformed one.
  const headlineHeight = await preview(page)
    .locator("h1")
    .evaluate((el) => el.getBoundingClientRect().height);

  const { rows, received } = await autoGenerate(page);

  await expect(page.getByTestId("auto-result-title")).toHaveText(/Generated \d+ animations/);
  await expect(page.getByTestId("auto-result-title")).toContainText(
    `Generated ${rows.length} animations`,
  );
  await expect(page.getByTestId("auto-result-prompt")).toHaveText(`“${PROMPT}”`);

  // One row per element, and enough of them that the bulk path is what ran.
  expect(new Set(rows.map((r) => r.vmId)).size).toBe(rows.length);
  expect(rows.length).toBeGreaterThan(BULK_APPLY_LIMIT);
  expect(rows.map((r) => r.vmId)).toEqual(
    expect.arrayContaining([headlineId, ctaId, belowFoldId]),
  );

  // The target floor is 40 px wide × 16 px tall, not 40 × 40: ordinary headings
  // and one-line text are what Auto-generate exists for. The fixture keeps
  // browser-default heading sizes so this stays proven; do not "fix" it by
  // enlarging them.
  expect(headlineHeight).toBeGreaterThanOrEqual(16);
  expect(headlineHeight).toBeLessThan(40);
  expect(rows.some((r) => r.tag === "h2")).toBe(true);
  expect(rows.some((r) => r.tag === "p")).toBe(true);

  // A block animates as one unit (D6): each card, the testimonial and the
  // figure get ONE row, and the entrance targets inside them get none. The
  // bridge pre-filter cannot know about nesting, so these are the agent's own
  // skips and the caption counts them.
  // h1, .lede, .cta, 3 cards, the logo, the proof h2 + p, the blockquote, the
  // figure, #below-fold + its p. Exact on purpose: a fixture edit should have
  // to look at this list.
  expect(rows).toHaveLength(13);
  const rowIds = new Set(rows.map((r) => r.vmId));
  const idsOf = (selector: string) =>
    preview(page)
      .locator(selector)
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-vm-id") ?? ""));
  const cardIds = await idsOf("article.card");
  expect(cardIds).toHaveLength(3);
  for (const vmId of cardIds) expect(rows.filter((r) => r.vmId === vmId)).toHaveLength(1);
  const nestedSelector = "article.card h2, article.card p, blockquote p, figure img";
  const nestedIds = await idsOf(nestedSelector);
  expect(nestedIds).toHaveLength(9);
  for (const vmId of nestedIds) expect(rowIds.has(vmId), `nested ${vmId}`).toBe(false);
  for (const selector of [".lede", "main > img", "#proof-heading", "blockquote", "figure"]) {
    expect(rowIds.has(await vmIdOf(page, selector)), selector).toBe(true);
  }
  const caption = page.getByTestId("auto-result-caption");
  await expect(caption).toContainText("inside an animated block");
  const skippedCount = Number(/Skipped (\d+) elements?/.exec((await caption.textContent()) ?? "")?.[1]);
  expect(skippedCount).toBeGreaterThanOrEqual(6);
  expect(skippedCount).toBe(nestedIds.length);
  const nestedStyles = await preview(page)
    .locator(nestedSelector)
    .evaluateAll((els) => els.map((el) => el.getAttribute("style") ?? ""));
  for (const style of nestedStyles) expect(style).not.toContain("vm-");
  test.info().annotations.push({ type: "auto-generate skipped", description: String(skippedCount) });
  test.info().annotations.push({ type: "auto-generate rows", description: String(rows.length) });

  // Categories and triggers (D6): links and buttons hover, everything else
  // enters; nothing ever exits.
  for (const r of rows) {
    expect(r.entry.category, `${r.tag} ${r.vmId}`).not.toBe("exit");
    const hoverTarget = r.tag === "a" || r.tag === "button";
    expect(r.entry.category, `${r.tag} ${r.vmId}`).toBe(hoverTarget ? "hover" : "entrance");
    expect(r.trigger, `${r.tag} ${r.vmId}`).toMatch(hoverTarget ? /^hover$/ : /^(load|in-view)$/);
    expect(r.edited, `${r.tag} ${r.vmId}`).toBe(false);
  }

  const cta = rows.find((r) => r.vmId === ctaId);
  expect(cta?.trigger).toBe("hover");
  expect(cta?.entry.category).toBe("hover");
  await expect(row(page, ctaId).getByTestId("auto-result-row-meta")).toHaveText(/^hover/);

  const belowFold = rows.find((r) => r.vmId === belowFoldId);
  expect(belowFold?.trigger).toBe("in-view");
  await expect(row(page, belowFoldId).getByTestId("auto-result-row-meta")).toHaveText(/^in-view/);
  expect(rows.find((r) => r.vmId === headlineId)?.trigger).toBe("load");

  // Stagger: the n-th `load` entrance in document (= list) order waits
  // n × 60 ms, capped; everything else keeps the catalog's default delay.
  const loadRows = rows.filter((r) => r.trigger === "load");
  expect(loadRows.length).toBeGreaterThan(1);
  expect(loadRows.map((r) => r.delay)).toEqual(
    loadRows.map((_, n) => `${Math.min(n * STAGGER_MS, STAGGER_CAP_MS)}ms`),
  );
  for (const r of rows.filter((other) => other.trigger !== "load")) {
    expect(r.delay, `${r.tag} ${r.vmId}`).toBe(defaultOf(r.entry, "delay"));
  }

  // What the frame shows. The bridge writes the `animation-*` group inline
  // only while a trigger is armed (protocol spec D3): `load` is armed at once,
  // an `in-view` element not yet in view is HELD on its first keyframe (the
  // group is there, paused), and a `hover` element has no group until the
  // pointer is over it.
  for (const r of rows) {
    const el = element(page, r.vmId);
    if (r.trigger === "hover") {
      expect(await inline(el, "animation-name"), `${r.tag} ${r.vmId}`).toBe("");
    } else {
      await expect
        .poll(() => inline(el, "animation-name"), { message: `${r.tag} ${r.vmId}` })
        .toMatch(KEYFRAMES);
    }
  }
  expect(await inline(element(page, belowFoldId), "animation-play-state")).toBe("paused");
  const animatedInFrame = await preview(page)
    .locator("[data-vm-id]")
    .evaluateAll(
      (els) =>
        els.filter((el) => (el as HTMLElement).style.getPropertyValue("animation-name").startsWith("vm-"))
          .length,
    );
  expect(animatedInFrame).toBe(rows.filter((r) => r.trigger !== "hover").length);

  // The pointer arms a hover assignment.
  await preview(page).locator(".cta").hover();
  await expect.poll(() => inline(element(page, ctaId), "animation-name")).toMatch(KEYFRAMES);

  // More than BULK_APPLY_LIMIT changes in one flush: one `state:load`, never a
  // burst of `apply`. Read last, so a late second message would be caught.
  const run = await received();
  expect(run.filter((type) => type === "state:load")).toHaveLength(1);
  expect(run.filter((type) => type === "apply")).toHaveLength(0);
  expect(run.filter((type) => type === "elements:query")).toHaveLength(1);

  expect(versionPosts()).toBe(0);
  await expect(page.getByTestId("unsaved-indicator")).toBeVisible();
});

test("switching away from an untouched generated element raises no guard", async ({ page }) => {
  const versionPosts = watchVersionPosts(page);
  await cloneFixture(page);

  const headlineId = await vmIdOf(page, "h1");
  const ledeId = await vmIdOf(page, ".lede");
  await autoGenerate(page);

  await row(page, headlineId).click();
  const tuning = page.getByTestId("panel-tuning");
  await expect(tuning.getByText(headlineId, { exact: true })).toBeVisible();

  // A different element, straight from the page. The agent's work on the h1
  // is untouched, so there is nothing to ask about (plan D2).
  await preview(page).locator(".lede").click();

  await expect(tuning.getByText(ledeId, { exact: true })).toBeVisible();
  await expect(preview(page).locator("[data-vm-overlay]")).toHaveAttribute(
    "data-vm-selected",
    ledeId,
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(/Save changes to/)).toHaveCount(0);

  await tuning.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("panel-auto-result")).toBeVisible();
  for (const vmId of [headlineId, ledeId]) {
    await expect(row(page, vmId)).toBeVisible();
    await expect(row(page, vmId)).not.toContainText("edited");
    expect(await inline(element(page, vmId), "animation-name"), vmId).toMatch(KEYFRAMES);
  }

  expect(versionPosts()).toBe(0);
  await expect(page.getByTestId("unsaved-indicator")).toBeVisible();
});

test("Regenerate and Remove all keep what the designer tuned by hand", async ({ page }) => {
  const versionPosts = watchVersionPosts(page);
  await cloneFixture(page);

  const headlineId = await vmIdOf(page, "h1");
  const headline = element(page, headlineId);
  const { rows } = await autoGenerate(page);
  const others = rows.filter((r) => r.vmId !== headlineId).map((r) => r.vmId);

  // No catalog default is 1350 ms, so this is always a hand edit.
  await row(page, headlineId).click();
  await expect(page.getByTestId("panel-tuning")).toBeVisible();
  await setDuration(page, 1350);
  await expect.poll(() => inline(headline, "animation-duration")).toBe("1350ms");
  const tunedName = await inline(headline, "animation-name");
  expect(tunedName).toMatch(KEYFRAMES);

  await page.getByTestId("panel-tuning").getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("panel-auto-result")).toBeVisible();
  await expect(row(page, headlineId)).toContainText("edited");
  await expect(row(page, headlineId).getByTestId("auto-result-row-meta")).toContainText("1350ms");

  // Regenerate re-rolls the agent's elements only. The frame hears about it
  // as one `state:load` or as a few `apply`s, depending on how many picks the
  // new seed happened to change.
  const before = (await receivedTypes(page)).length;
  await page.getByRole("button", { name: "Regenerate" }).click();
  await expect
    .poll(async () =>
      (await receivedTypes(page)).slice(before).some((type) => type === "state:load" || type === "apply"),
    )
    .toBe(true);
  await bridgeSettled(page);

  await expect(page.getByTestId("agent-run-error")).toHaveCount(0);
  await expect(page.getByTestId("auto-result-row")).toHaveCount(rows.length);
  await expect(row(page, headlineId)).toContainText("edited");
  await expect(row(page, headlineId).getByTestId("auto-result-row-meta")).toContainText("1350ms");
  await expect.poll(() => inline(headline, "animation-duration")).toBe("1350ms");
  expect(await inline(headline, "animation-name")).toBe(tunedName);

  await page.getByRole("button", { name: "Remove all" }).click();

  // The tuned h1 is the designer's now: it stays, animated, and it is the one
  // row left, so the panel stays on the list.
  await expect(page.getByTestId("panel-auto-result")).toBeVisible();
  await expect(page.getByTestId("auto-result-row")).toHaveCount(1);
  await expect(page.getByTestId("auto-result-title")).toContainText("Generated 1 animation");
  await expect(row(page, headlineId)).toContainText("edited");
  for (const vmId of others) {
    // Nothing of ours is left inline: not the group, not a `--vm-*` property.
    await expect
      .poll(async () => (await element(page, vmId).getAttribute("style")) ?? "", { message: vmId })
      .not.toContain("vm-");
  }
  expect(await inline(headline, "animation-name")).toBe(tunedName);
  expect(await inline(headline, "animation-duration")).toBe("1350ms");

  expect(versionPosts()).toBe(0);
  await expect(page.getByTestId("unsaved-indicator")).toBeVisible();
});
