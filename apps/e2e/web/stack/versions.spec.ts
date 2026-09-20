import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { stack } from "./env";

/**
 * Phase 6 exit criteria (`docs/build_plan.md`), against the real api + Postgres
 * + production web build: a save writes no version until the user clicks Save,
 * five saves accumulate v1..v5, a past version can be viewed read-only and
 * matches `stateAt(vN)`, a restore reproduces it as a new version, and a save
 * that races another tab's save surfaces the 409 as the rebase/discard dialog.
 *
 * Same helpers as `bridge.spec.ts`: real clone, real origins, elements found
 * by the fixture's own markup (a real clone numbers elements `vm-1`, `vm-2`,
 * … via `HtmlRewriter`, so there are no fixed `data-vm-id`s to assert on).
 */

const FIXTURE_URL = `${stack.fixtureOrigin}/marketing.html`;

function preview(page: Page) {
  return page.frameLocator('iframe[title="Cloned page preview"]');
}

/** `/p/<id>` → `<id>`, once the clone has landed and the bridge has handshaked. */
async function cloneFixture(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Page URL").fill(FIXTURE_URL);
  await page.getByRole("button", { name: "Clone" }).click();
  // A real clone: fetch, parse, rewrite, instrument, insert. Give the JVM room.
  await page.waitForURL(/\/p\/[^/]+$/, { timeout: 60_000 });
  await expect(preview(page).locator("[data-vm-overlay]")).toBeAttached({ timeout: 30_000 });
  const match = page.url().match(/\/p\/([^/]+)$/);
  if (!match) throw new Error(`could not read a project id off ${page.url()}`);
  return match[1];
}

/** Same navigation, for a second tab already given the project id. */
async function openProject(page: Page, projectId: string): Promise<void> {
  await page.goto(`/p/${projectId}`);
  await expect(preview(page).locator("[data-vm-overlay]")).toBeAttached({ timeout: 30_000 });
}

/** Click an element in the frame, pick Fade In Up, and land on the tuning panel. */
async function applyFadeInUp(page: Page, element: Locator): Promise<void> {
  await element.click();
  await page.getByRole("button", { name: "Choose custom animation" }).click();
  await page.getByRole("button", { name: "Fade In Up", exact: true }).click();
  await expect(page.getByTestId("panel-tuning")).toBeVisible();
}

/** The tuning panel's Duration field, committed and reflected on the element. */
async function setDuration(page: Page, element: Locator, ms: number): Promise<void> {
  const field = page.getByRole("spinbutton", { name: "Duration value" });
  await field.fill(String(ms));
  await field.press("Enter");
  await expect(async () => {
    const value = await element.evaluate((el) => (el as HTMLElement).style.animationDuration);
    expect(value).toBe(`${ms}ms`);
  }).toPass();
}

/** The mono chip beside the project's host+path in the top bar — "v5", "v6", … */
function versionChip(page: Page) {
  return page.locator('[data-slot="top-bar-context"]');
}

async function expectToast(page: Page, message: string): Promise<void> {
  await expect(page.locator('[data-slot="toaster"]').getByText(message, { exact: true })).toBeVisible();
}

/** Top bar Save → dialog "Save as v<seq>" → confirm → toast "Saved v<seq>". */
async function saveVersion(page: Page, seq: number): Promise<void> {
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("save-dialog")).toContainText(`Save as v${seq}`);
  await page.getByRole("button", { name: "Save version" }).click();
  await expectToast(page, `Saved v${seq}`);
  await expect(versionChip(page).getByText(`v${seq}`, { exact: true })).toBeVisible();
}

type VersionSummary = { id: string; seq: number };
type VersionsList = { currentVersionId: string; versions: VersionSummary[] };
type VersionState = { versionId: string; state: Record<string, { params: Record<string, string> }> };

async function listVersions(request: APIRequestContext, projectId: string): Promise<VersionsList> {
  const response = await request.get(`${stack.apiOrigin}/projects/${projectId}/versions`);
  expect(response.ok(), `GET /versions: ${response.status()}`).toBe(true);
  return response.json();
}

async function getVersionState(
  request: APIRequestContext,
  projectId: string,
  versionId: string,
): Promise<VersionState> {
  const response = await request.get(
    `${stack.apiOrigin}/projects/${projectId}/versions/${versionId}/state`,
  );
  expect(response.ok(), `GET /versions/${versionId}/state: ${response.status()}`).toBe(true);
  return response.json();
}

function bySeq(versions: VersionSummary[], seq: number): VersionSummary {
  const found = versions.find((v) => v.seq === seq);
  if (!found) throw new Error(`no version with seq ${seq} in ${JSON.stringify(versions)}`);
  return found;
}

/** Fails the test if the frame or the shell threw at any point in the run. */
function watchForPageErrors(page: Page): () => void {
  const errors: string[] = [];
  const handler = (error: Error) => errors.push(error.message);
  page.on("pageerror", handler);
  return () => {
    page.off("pageerror", handler);
    expect(errors, "unexpected page errors").toEqual([]);
  };
}

test.describe("version history", () => {
  test("save x5, view v2 read-only, restore reproduces it as v6", async ({ page, request }) => {
    // Five saves, a view, a restore, several round trips of API assertions in
    // between: comfortably over the 30s default under a parallel Docker run.
    test.setTimeout(60_000);
    const assertNoPageErrors = watchForPageErrors(page);

    const projectId = await cloneFixture(page);
    const headline = preview(page).locator("#headline");

    // v0 only, until the first Save.
    const initial = await listVersions(request, projectId);
    expect(initial.versions.map((v) => v.seq)).toEqual([0]);

    // Attached only now: the clone itself is a `POST /projects`, and would
    // otherwise count as a write "before the first Save".
    const writes: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "GET") return;
      if (req.url().startsWith(stack.apiOrigin)) writes.push(`${req.method()} ${req.url()}`);
    });
    // The exact request a Save is allowed to make, and nothing else: scoped to
    // *this* test's project, so a write against another project would fail the
    // comparison rather than pass as "one write".
    const versionsWrite = `POST ${stack.apiOrigin}/projects/${projectId}/versions`;

    await applyFadeInUp(page, headline);
    expect(writes, "no write before the first Save").toEqual([]);
    expect((await listVersions(request, projectId)).versions).toHaveLength(1);

    await saveVersion(page, 1);
    expect(writes, "the first Save posts one version").toEqual([versionsWrite]);

    const durations = [700, 800, 900, 1000];
    for (const [index, ms] of durations.entries()) {
      await setDuration(page, headline, ms);
      await saveVersion(page, index + 2);
    }
    // Five saves, five posts to the versions endpoint, nothing else — in
    // particular no write from the live tuning in between (CLAUDE.md rule 9).
    expect(writes).toEqual(Array.from({ length: 5 }, () => versionsWrite));

    const afterFive = await listVersions(request, projectId);
    expect(afterFive.versions.map((v) => v.seq).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);

    // History tab: the draft is clean (last action was a Save), so no guard.
    await page.getByRole("tab", { name: "History" }).click();
    const historyPanel = page.getByTestId("panel-history");
    // One per version, counted by the thing only a version row has: its
    // expand/collapse button (`components/history/version-row.tsx`). Counting
    // every `button` in the panel would also count an expanded row's Restore
    // and Export, or any button a future panel header grows.
    const rows = historyPanel.locator("button[aria-expanded]");
    await expect(rows).toHaveCount(6);
    // Newest first, v5 marked Current.
    await expect(rows.first()).toContainText("v5");
    await expect(rows.first()).toContainText("Current");

    // Click the v2 row (exact label span, not the "v2" substring of anything longer).
    await historyPanel.getByText("v2", { exact: true }).click();

    await expect(page.getByText("Viewing v2 · read-only")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);

    const v2 = bySeq(afterFive.versions, 2);
    const v2State = await getVersionState(request, projectId, v2.id);
    expect(Object.keys(v2State.state)).toHaveLength(1);
    const [v2VmId, v2Assignment] = Object.entries(v2State.state)[0];
    // `durations[0]` — "700ms" — is what this save wrote, but the assertion of
    // record is the api-derived comparison below, not a literal in here.
    const v2Duration = v2Assignment.params.duration;

    await expect(async () => {
      const value = await headline.evaluate((el) => (el as HTMLElement).style.animationDuration);
      expect(value).toBe(v2Duration);
    }).toPass();
    // The vmId a real clone gave this element is stable across the whole run.
    const headlineVmId = await headline.getAttribute("data-vm-id");
    expect(v2VmId).toBe(headlineVmId);

    // Restore: "Restore as v6" on the banner.
    await page.getByRole("button", { name: "Restore as v6" }).click();
    await expectToast(page, "Restored v2 as v6");
    await expect(page.getByText("Viewing v2 · read-only")).toHaveCount(0);
    await expect(versionChip(page).getByText("v6", { exact: true })).toBeVisible();

    // A restore is its own endpoint, and it is the only write the whole flow
    // added on top of the five saves.
    expect(writes).toEqual([
      ...Array.from({ length: 5 }, () => versionsWrite),
      `POST ${stack.apiOrigin}/projects/${projectId}/versions/${v2.id}/restore`,
    ]);

    await expect(rows).toHaveCount(7);
    await expect(rows.first()).toContainText("v6");
    await expect(rows.first()).toContainText("Current");

    const afterRestore = await listVersions(request, projectId);
    const v6 = bySeq(afterRestore.versions, 6);
    const v6State = await getVersionState(request, projectId, v6.id);
    expect(v6State.state).toEqual(v2State.state);

    await expect(async () => {
      const value = await headline.evaluate((el) => (el as HTMLElement).style.animationDuration);
      expect(value).toBe(v2Duration);
    }).toPass();

    assertNoPageErrors();
  });

  test("a save that races another tab's save gets a 409, and 'apply my changes on top' rebases", async ({
    page,
    context,
    request,
  }) => {
    // Two clones, two saves, a conflict and a rebase: over the 30s default
    // under a parallel Docker run.
    test.setTimeout(60_000);
    const projectId = await cloneFixture(page);
    const headline = preview(page).locator("#headline");
    // Both of A's locators are taken from A. The `.cta` assertions at the end
    // are about *A's* frame, and a locator taken from `pageB` would keep
    // answering "Target page, context or browser has been closed" after
    // `pageB.close()` below — a poll that can never converge.
    const cta = preview(page).locator(".cta");

    await applyFadeInUp(page, headline);
    await saveVersion(page, 1); // A now sits on v1

    const pageB = await context.newPage();
    await openProject(pageB, projectId);
    await applyFadeInUp(pageB, preview(pageB).locator(".cta"));
    await saveVersion(pageB, 2); // B saves v2, still parented on v1
    await pageB.close();
    // What a designer does when they go back to the other tab. Also what keeps
    // A's `requestAnimationFrame` (the bridge client's flush) unthrottled.
    await page.bringToFront();

    // Back in A, still parented on v1: change Duration and Save collides.
    await setDuration(page, headline, 750);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("save-dialog")).toContainText("Save as v2");
    await page.getByRole("button", { name: "Save version" }).click();

    await expect(page.getByTestId("conflict-dialog")).toContainText("v2 was saved somewhere else");
    await page.getByRole("button", { name: "Apply my changes on top" }).click();

    // The dialog reopens, now forked from v2, with only A's own change.
    const saveDialog = page.getByTestId("save-dialog");
    await expect(saveDialog).toContainText("Save as v3");

    // …and "Changes in this version" proves the rebase replayed *only* A's
    // diff: B's `.cta` assignment arrived as the new base
    // (`applyDiff(theirs, mine)`), so it is not a change in this version, and
    // A's duration edit is — as a change, not an addition.
    const headlineVmId = await headline.getAttribute("data-vm-id");
    const ctaVmId = await cta.getAttribute("data-vm-id");
    const changeRows = saveDialog
      .getByRole("list", { name: "Changes in this version" })
      .getByRole("listitem");
    await expect(changeRows).toHaveCount(1);
    const onlyChange = changeRows.first();
    // The sign column is a colour plus an sr-only word ("Added"/"Changed"/"Removed").
    await expect(onlyChange).toContainText("Changed");
    await expect(onlyChange.locator('[data-slot="element-tag"]')).toHaveText(headlineVmId ?? "");
    await expect(onlyChange).toContainText(/duration \S+ → 750ms/);
    // Nothing in the dialog mentions the element the other tab animated.
    await expect(saveDialog.getByText(ctaVmId ?? "", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Save version" }).click();
    await expectToast(page, "Saved v3");

    const versions = await listVersions(request, projectId);
    expect(versions.versions.map((v) => v.seq).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);

    const v3 = bySeq(versions.versions, 3);
    const v3State = await getVersionState(request, projectId, v3.id);
    expect(Object.keys(v3State.state)).toHaveLength(2);
    const durations = Object.values(v3State.state).map((a) => a.params.duration);
    expect(durations).toContain("750ms");

    // Both elements carry an animation in A's frame.
    await expect(async () => {
      const name = await headline.evaluate((el) => getComputedStyle(el).animationName);
      expect(name).toMatch(/vm-fade-in-up/);
    }).toPass();
    await expect(async () => {
      const name = await cta.evaluate((el) => getComputedStyle(el).animationName);
      expect(name).toMatch(/vm-fade-in-up/);
    }).toPass();
  });

  test("a save that races another tab's save gets a 409, and 'discard my changes' loads theirs", async ({
    page,
    context,
    request,
  }) => {
    // Two clones, two saves, a conflict: over the 30s default under a
    // parallel Docker run.
    test.setTimeout(60_000);
    const projectId = await cloneFixture(page);
    const headline = preview(page).locator("#headline");
    // A's own `.cta`, not `pageB`'s — see the rebase test above.
    const cta = preview(page).locator(".cta");

    await applyFadeInUp(page, headline);
    await saveVersion(page, 1); // A now sits on v1

    const pageB = await context.newPage();
    await openProject(pageB, projectId);
    await applyFadeInUp(pageB, preview(pageB).locator(".cta"));
    await saveVersion(pageB, 2); // B saves v2, still parented on v1
    await pageB.close();
    await page.bringToFront();

    await setDuration(page, headline, 850);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("save-dialog")).toContainText("Save as v2");
    await page.getByRole("button", { name: "Save version" }).click();

    await expect(page.getByTestId("conflict-dialog")).toContainText("v2 was saved somewhere else");
    await page.getByRole("button", { name: "Discard my changes" }).click();
    await expectToast(page, "Loaded v2");

    // No extra version was written, and A's draft is now clean (Save disabled).
    const versions = await listVersions(request, projectId);
    expect(versions.versions.map((v) => v.seq).sort((a, b) => a - b)).toEqual([0, 1, 2]);
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

    // A's frame shows B's state: the cta is animated, the headline's duration
    // change never made it in.
    await expect(async () => {
      const name = await cta.evaluate((el) => getComputedStyle(el).animationName);
      expect(name).toMatch(/vm-fade-in-up/);
    }).toPass();
    await expect(async () => {
      const value = await headline.evaluate((el) => (el as HTMLElement).style.animationDuration);
      expect(value).not.toBe("850ms");
    }).toPass();
  });
});
