/**
 * The Entry screen's "Recent projects" column.
 *
 * There is no list endpoint (`apps/api/openapi.yaml` has no `GET /projects`),
 * so the handoff's list is whatever *this browser* has created or opened:
 * `localStorage` only, written on a successful clone and whenever the editor
 * loads a project. Never a source of truth — a missing, stale or corrupt store
 * degrades to an empty column, which the screen hides.
 *
 * Pure read/write helpers so the screen can stay declarative and the rules
 * (cap, ordering, tolerance) are testable without a DOM.
 */

/** Ruling in docs/plans/phase-3-web-shell.md, "Design handoff". */
export const RECENT_PROJECTS_KEY = "vm-recent-projects";
export const RECENT_PROJECTS_LIMIT = 8;

export type RecentProject = {
  id: string;
  title: string;
  sourceUrl: string;
  /** ISO 8601. */
  openedAt: string;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** `Intl` with a fixed locale so the meta line reads the same everywhere. */
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function isRecentProject(value: unknown): value is RecentProject {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.sourceUrl === "string" &&
    // A timestamp that cannot be read is not a timestamp: the row would sort
    // arbitrarily and its meta line would trail a bare " · ".
    typeof candidate.openedAt === "string" &&
    !Number.isNaN(Date.parse(candidate.openedAt))
  );
}

/** Milliseconds since the epoch. Every validated entry has a readable date. */
function openedAtMs(entry: RecentProject): number {
  return Date.parse(entry.openedAt);
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Storage can be blocked outright (Safari private mode, some enterprise
    // policies); an empty column is the right fallback.
    return null;
  }
}

/** The stored JSON, or `null` when there is nothing readable. */
function readRaw(): string | null {
  const store = storage();
  if (!store) return null;
  try {
    return store.getItem(RECENT_PROJECTS_KEY);
  } catch {
    return null;
  }
}

function parseRaw(raw: string | null): RecentProject[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(isRecentProject)
    .sort((a, b) => openedAtMs(b) - openedAtMs(a))
    .slice(0, RECENT_PROJECTS_LIMIT);
}

/**
 * Every well-formed entry in the store, most recent first, capped at
 * {@link RECENT_PROJECTS_LIMIT}. Anything unreadable reads as an empty list.
 */
export function readRecentProjects(): RecentProject[] {
  return parseRaw(readRaw());
}

/**
 * Records `project` as the most recently opened one and returns the new list.
 * A project already in the store moves to the front rather than duplicating.
 * Writing is best-effort: a full or read-only store is not worth an error.
 */
export function rememberRecentProject(
  project: Pick<RecentProject, "id" | "title" | "sourceUrl">,
  now: Date = new Date(),
): RecentProject[] {
  const entry: RecentProject = { ...project, openedAt: now.toISOString() };
  const next = [entry, ...readRecentProjects().filter((p) => p.id !== entry.id)].slice(
    0,
    RECENT_PROJECTS_LIMIT,
  );

  const store = storage();
  try {
    store?.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next));
  } catch {
    // Ignored on purpose — see above.
  }
  for (const listener of listeners) listener();

  return next;
}

// ---------------------------------------------------------------------------
// As an external store, so the screen reads it with `useSyncExternalStore`
// rather than an effect: `localStorage` is not available while the page is
// rendered on the server, and the snapshot has to stay referentially stable
// between renders or React re-renders forever.
// ---------------------------------------------------------------------------

const EMPTY: readonly RecentProject[] = Object.freeze([]);
const listeners = new Set<() => void>();

/** The raw JSON the cached snapshot was parsed from. */
let snapshotSource: string | null = null;
let snapshot: readonly RecentProject[] = EMPTY;

export function subscribeRecentProjects(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab cloning a page counts too.
  if (typeof window !== "undefined") window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", listener);
  };
}

export function getRecentProjectsSnapshot(): readonly RecentProject[] {
  const raw = readRaw();
  if (raw !== snapshotSource) {
    snapshotSource = raw;
    snapshot = raw ? parseRaw(raw) : EMPTY;
  }
  return snapshot;
}

/** Nothing is recent on the server: there is no browser to have opened it. */
export function getServerRecentProjects(): readonly RecentProject[] {
  return EMPTY;
}

/** `https://nimbus.app/pricing` → `nimbus.app`. Unparseable input is passed through. */
export function sourceUrlHost(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).host;
  } catch {
    return sourceUrl;
  }
}

/**
 * The meta line's age: "just now" / "20m ago" / "2h ago" / "2d ago", and a
 * short date once a week has passed (the handoff's "Sep 9").
 */
export function formatRelativeTime(openedAt: string, now: Date = new Date()): string {
  const then = Date.parse(openedAt);
  if (Number.isNaN(then)) return "";

  // A clock skew that puts the timestamp in the future reads as "just now"
  // rather than a negative age.
  const elapsed = Math.max(0, now.getTime() - then);

  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d ago`;
  return shortDate.format(then);
}
