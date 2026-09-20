/**
 * What changed between the saved version and the draft, in the shape the Save
 * dialog's "CHANGES IN THIS VERSION" list renders (`docs/design/README.md`
 * "3. Dialogs & toast").
 *
 * Pure, and deliberately without a catalog import: names are resolved through
 * a `CatalogLookup` the caller supplies, so every row resolves against the
 * catalog version *its own assignment pinned* rather than against whatever the
 * editor currently authors with (CLAUDE.md: "the runtime and exporter resolve
 * against that pinned version"). Call sites pass `getEntry` from the
 * `animation-catalog` package.
 *
 * Nothing here calls the API; `useSaveFlow` turns these rows into a `Diff` body.
 */
import type { Assignment, EditorStateMap } from "@/lib/api-client";
import { assignmentsEqual } from "@/lib/assignment";

/** The little a row needs from a catalog entry — satisfied by either `CatalogEntry` type. */
export type CatalogLookupEntry = {
  name: string;
  params: readonly { key: string }[];
};

/** `(catalogVersion, animationId) => entry`, e.g. `getEntry` from `animation-catalog`. */
export type CatalogLookup = (
  catalogVersion: string,
  animationId: string,
) => CatalogLookupEntry | undefined;

export type DiffRowKind = "added" | "changed" | "removed";

/** The handoff's sign column: + green, ~ orange, − red. */
const SIGNS: Readonly<Record<DiffRowKind, "+" | "~" | "−">> = {
  added: "+",
  changed: "~",
  removed: "−",
};

export type DiffRow = {
  kind: DiffRowKind;
  sign: (typeof SIGNS)[DiffRowKind];
  /** `data-vm-id` of the element — its label until the bridge sends a nicer one (Phase 4). */
  vmId: string;
  /** Catalog name of the animation, or the raw id when its pinned version no longer has it. */
  name: string;
  /**
   * The row's right-hand column. An added row lists its notable params
   * ("600ms · ease-out · 24px"); a changed row lists *only what changed*
   * ("duration 600ms → 800ms"); a removed row has nothing to add to its sign.
   */
  meta: string;
};

export type DiffSummary = {
  rows: DiffRow[];
  /** Prefill for the Save dialog's label field; `""` when nothing changed. */
  label: string;
};

/**
 * The contract's `label` cap (`apps/api/openapi.yaml`), mirrored here so the
 * prefilled label a big diff produces can never be the thing that turns a
 * normal Save into a 400. Same value as the server's `StateMath.kt`.
 */
export const MAX_LABEL_LENGTH = 200;

/**
 * How many rows of each kind (set, then removed) the label lists by name
 * before folding the rest into "+N more" — same as the server's
 * `StateMath.kt` `describeDiff`, so a save the client prefilled and one the
 * server would have generated read alike.
 */
export const MAX_LISTED = 3;

/** CSS plumbing rather than a knob a designer reaches for: never in an added row's meta. */
const PLUMBING: ReadonlySet<string> = new Set(["fillMode", "direction"]);

/** Values that carry no information, per param: a row is shorter without them. */
const SILENT: Readonly<Record<string, readonly string[]>> = {
  delay: ["0ms", "0s", "0"],
  iteration: ["1"],
};

/**
 * Absent, in the before/after columns of a changed row. Words rather than a
 * dash: the handoff's glyph set is "✦ ↻ ‹ ▾ ⌕ › ✓ ∞ !" and nothing else. Not
 * "none" — that is a real `fillMode` value in this catalog, so "fillMode none
 * → both" would not say whether the param was unset or set to `none`.
 */
const ABSENT = "not set";

/** The handoff's glyph for an endless repeat; every other value speaks for itself. */
function displayValue(value: string): string {
  return value === "infinite" ? "∞" : value;
}

function nameOf(assignment: Assignment, lookup: CatalogLookup): string {
  return lookup(assignment.catalogVersion, assignment.animationId)?.name ?? assignment.animationId;
}

/**
 * Param keys in the order the catalog declares them, with any key the
 * assignment carries but the entry does not appended — an assignment pinned to
 * a version this build cannot resolve still gets a readable meta.
 */
function paramKeys(
  assignment: Assignment,
  entry: CatalogLookupEntry | undefined,
  ...extra: ReadonlyArray<Readonly<Record<string, string>>>
): string[] {
  const keys = entry ? entry.params.map((param) => param.key) : [];
  const seen = new Set(keys);
  for (const source of [assignment.params, ...extra]) {
    for (const key of Object.keys(source)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function isSilent(key: string, value: string): boolean {
  // `hasOwn`, not a bare index: a param keyed `constructor` would otherwise
  // resolve to the inherited function and throw on `.includes`.
  return Object.hasOwn(SILENT, key) && SILENT[key].includes(value);
}

/** "600ms · ease-out · 24px" — what this assignment is, at a glance. */
function addedMeta(assignment: Assignment, lookup: CatalogLookup): string {
  const entry = lookup(assignment.catalogVersion, assignment.animationId);
  return paramKeys(assignment, entry)
    .filter((key) => {
      const value = assignment.params[key];
      return value !== undefined && !PLUMBING.has(key) && !isSilent(key, value);
    })
    .map((key) => displayValue(assignment.params[key]))
    .join(" · ");
}

/**
 * "trigger load → hover · duration 600ms → 800ms" — only the differences.
 *
 * When the *animation itself* was swapped the params are not comparable: two
 * entries declare different knobs, so a key-by-key diff reads as a row of
 * appearing and vanishing params ("scale not set → 1.05 · distance 24px → not
 * set") that says nothing a reader wants. In that case the row says what the
 * element now is instead — the swap, then the new assignment's added-style
 * meta. Fields that *are* comparable across a swap (the catalog pin, the
 * trigger) still read as before → after.
 */
function changedMeta(before: Assignment, after: Assignment, lookup: CatalogLookup): string {
  const parts: string[] = [];
  const swapped = before.animationId !== after.animationId;

  if (swapped) {
    parts.push(`animation ${nameOf(before, lookup)} → ${nameOf(after, lookup)}`);
  }
  if (before.catalogVersion !== after.catalogVersion) {
    parts.push(`catalog ${before.catalogVersion} → ${after.catalogVersion}`);
  }
  if (before.trigger !== after.trigger) {
    parts.push(`trigger ${before.trigger} → ${after.trigger}`);
  }

  if (swapped) {
    const meta = addedMeta(after, lookup);
    if (meta) parts.push(meta);
    return parts.join(" · ");
  }

  const entry = lookup(after.catalogVersion, after.animationId);
  for (const key of paramKeys(after, entry, before.params)) {
    const from = before.params[key];
    const to = after.params[key];
    if (from === to) continue;
    parts.push(
      `${key} ${from === undefined ? ABSENT : displayValue(from)} → ${
        to === undefined ? ABSENT : displayValue(to)
      }`,
    );
  }

  return parts.join(" · ");
}

/**
 * `current` → `draft`, as rows plus the label the Save dialog prefills
 * ("Fade In Up on vm-3, removed Pulse on vm-9").
 *
 * Sets come before removals, matching `Diff` in `openapi.yaml` ("`set` is
 * applied, then `remove`"); within each group the rows follow their own map's
 * key order.
 */
export function summariseDiff(
  current: EditorStateMap,
  draft: EditorStateMap,
  lookup: CatalogLookup,
): DiffSummary {
  const rows: DiffRow[] = [];

  for (const [vmId, assignment] of Object.entries(draft)) {
    const before = current[vmId];
    if (before === undefined) {
      rows.push({
        kind: "added",
        sign: SIGNS.added,
        vmId,
        name: nameOf(assignment, lookup),
        meta: addedMeta(assignment, lookup),
      });
      continue;
    }
    if (assignmentsEqual(before, assignment)) continue;
    rows.push({
      kind: "changed",
      sign: SIGNS.changed,
      vmId,
      name: nameOf(assignment, lookup),
      meta: changedMeta(before, assignment, lookup),
    });
  }

  for (const [vmId, assignment] of Object.entries(current)) {
    if (vmId in draft) continue;
    rows.push({
      kind: "removed",
      sign: SIGNS.removed,
      vmId,
      name: nameOf(assignment, lookup),
      meta: "",
    });
  }

  return { rows, label: labelFor(rows) };
}

/**
 * The Save dialog's prefill, capped at {@link MAX_LABEL_LENGTH} the way the
 * server's `describeDiff` caps the label it generates when a Save omits one:
 * at most {@link MAX_LISTED} set/changed rows and {@link MAX_LISTED} removed
 * rows spelled out, the rest folded into "+N more", then a hard truncation —
 * so a draft with a dozen changes (a common shape right after Phase 5's
 * auto-generate) never produces a label the contract's 200-character cap
 * would reject.
 */
function labelFor(rows: readonly DiffRow[]): string {
  const set = rows.filter((row) => row.kind !== "removed");
  const removed = rows.filter((row) => row.kind === "removed");
  const parts: string[] = [];

  for (const row of set.slice(0, MAX_LISTED)) {
    parts.push(`${row.name} on ${row.vmId}`);
  }
  if (set.length > MAX_LISTED) {
    parts.push(`+${set.length - MAX_LISTED} more`);
  }

  for (const row of removed.slice(0, MAX_LISTED)) {
    parts.push(`removed ${row.name} on ${row.vmId}`);
  }
  if (removed.length > MAX_LISTED) {
    parts.push(`+${removed.length - MAX_LISTED} more`);
  }

  const joined = parts.join(", ");
  return joined.length <= MAX_LABEL_LENGTH ? joined : `${joined.slice(0, MAX_LABEL_LENGTH - 1)}…`;
}
