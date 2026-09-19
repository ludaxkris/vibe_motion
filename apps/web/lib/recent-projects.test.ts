import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RECENT_PROJECTS_KEY,
  RECENT_PROJECTS_LIMIT,
  forgetRecentProject,
  formatRelativeTime,
  getRecentProjectsSnapshot,
  getServerRecentProjects,
  readRecentProjects,
  rememberRecentProject,
  sourceUrlHost,
  subscribeRecentProjects,
} from "./recent-projects";

function write(value: unknown) {
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(value));
}

const AT = (iso: string) => new Date(iso);

describe("readRecentProjects", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns an empty list when nothing is stored", () => {
    expect(readRecentProjects()).toEqual([]);
  });

  it("returns an empty list for unparseable JSON", () => {
    localStorage.setItem(RECENT_PROJECTS_KEY, "{not json");

    expect(readRecentProjects()).toEqual([]);
  });

  it("returns an empty list when the stored value is not an array", () => {
    write({ id: "proj_1" });

    expect(readRecentProjects()).toEqual([]);
  });

  it("drops entries that are missing fields or have the wrong types", () => {
    write([
      { id: "proj_1", title: "a.test", sourceUrl: "https://a.test", openedAt: "2026-09-18T10:00:00.000Z" },
      { id: "proj_2", title: "b.test", sourceUrl: "https://b.test" },
      { id: 3, title: "c.test", sourceUrl: "https://c.test", openedAt: "2026-09-18T10:00:00.000Z" },
      null,
      "nope",
    ]);

    expect(readRecentProjects().map((p) => p.id)).toEqual(["proj_1"]);
  });

  it("drops an entry whose openedAt is not a date, rather than showing a dangling meta line", () => {
    write([
      { id: "proj_1", title: "a", sourceUrl: "https://a.test", openedAt: "whenever" },
      { id: "proj_2", title: "b", sourceUrl: "https://b.test", openedAt: "" },
      {
        id: "proj_3",
        title: "c",
        sourceUrl: "https://c.test",
        openedAt: "2026-09-18T10:00:00.000Z",
      },
    ]);

    expect(readRecentProjects().map((p) => p.id)).toEqual(["proj_3"]);
  });

  it("orders most recent first regardless of the stored order", () => {
    write([
      { id: "old", title: "a", sourceUrl: "https://a.test", openedAt: "2026-09-01T00:00:00.000Z" },
      { id: "new", title: "b", sourceUrl: "https://b.test", openedAt: "2026-09-18T00:00:00.000Z" },
    ]);

    expect(readRecentProjects().map((p) => p.id)).toEqual(["new", "old"]);
  });

  it(`caps the list at ${RECENT_PROJECTS_LIMIT}`, () => {
    write(
      Array.from({ length: 20 }, (_, i) => ({
        id: `proj_${i}`,
        title: `p${i}`,
        sourceUrl: `https://p${i}.test`,
        openedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      })),
    );

    expect(readRecentProjects()).toHaveLength(RECENT_PROJECTS_LIMIT);
  });
});

describe("rememberRecentProject", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores the project with the time it was opened", () => {
    const stored = rememberRecentProject(
      { id: "proj_1", title: "nimbus.app/pricing", sourceUrl: "https://nimbus.app/pricing" },
      AT("2026-09-18T12:00:00.000Z"),
    );

    expect(stored).toEqual([
      {
        id: "proj_1",
        title: "nimbus.app/pricing",
        sourceUrl: "https://nimbus.app/pricing",
        openedAt: "2026-09-18T12:00:00.000Z",
      },
    ]);
    expect(readRecentProjects()).toEqual(stored);
  });

  it("moves an already-known project back to the front instead of duplicating it", () => {
    rememberRecentProject(
      { id: "proj_1", title: "a", sourceUrl: "https://a.test" },
      AT("2026-09-18T10:00:00.000Z"),
    );
    rememberRecentProject(
      { id: "proj_2", title: "b", sourceUrl: "https://b.test" },
      AT("2026-09-18T11:00:00.000Z"),
    );
    const stored = rememberRecentProject(
      { id: "proj_1", title: "a renamed", sourceUrl: "https://a.test" },
      AT("2026-09-18T12:00:00.000Z"),
    );

    expect(stored.map((p) => p.id)).toEqual(["proj_1", "proj_2"]);
    expect(stored[0]?.title).toBe("a renamed");
  });

  it(`keeps only the newest ${RECENT_PROJECTS_LIMIT}`, () => {
    for (let i = 0; i < 12; i += 1) {
      rememberRecentProject(
        { id: `proj_${i}`, title: `p${i}`, sourceUrl: `https://p${i}.test` },
        new Date(Date.UTC(2026, 0, i + 1)),
      );
    }

    const stored = readRecentProjects();
    expect(stored).toHaveLength(RECENT_PROJECTS_LIMIT);
    expect(stored[0]?.id).toBe("proj_11");
    expect(stored.at(-1)?.id).toBe("proj_4");
  });

  it("recovers from a corrupt store rather than throwing", () => {
    localStorage.setItem(RECENT_PROJECTS_KEY, "{not json");

    const stored = rememberRecentProject(
      { id: "proj_1", title: "a", sourceUrl: "https://a.test" },
      AT("2026-09-18T12:00:00.000Z"),
    );

    expect(stored.map((p) => p.id)).toEqual(["proj_1"]);
  });

  it("stays silent when storage refuses the write", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    try {
      expect(() =>
        rememberRecentProject({ id: "proj_1", title: "a", sourceUrl: "https://a.test" }),
      ).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });
});

describe("forgetRecentProject", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("removes just that project and keeps the rest in order", () => {
    rememberRecentProject({ id: "proj_1", title: "a", sourceUrl: "https://a.test" }, AT("2025-09-01T10:00:00Z"));
    rememberRecentProject({ id: "proj_2", title: "b", sourceUrl: "https://b.test" }, AT("2025-09-02T10:00:00Z"));
    rememberRecentProject({ id: "proj_3", title: "c", sourceUrl: "https://c.test" }, AT("2025-09-03T10:00:00Z"));

    expect(forgetRecentProject("proj_2").map((p) => p.id)).toEqual(["proj_3", "proj_1"]);
    expect(readRecentProjects().map((p) => p.id)).toEqual(["proj_3", "proj_1"]);
  });

  it("is a no-op for an id that is not in the store", () => {
    rememberRecentProject({ id: "proj_1", title: "a", sourceUrl: "https://a.test" });

    expect(forgetRecentProject("proj_missing").map((p) => p.id)).toEqual(["proj_1"]);
    expect(readRecentProjects().map((p) => p.id)).toEqual(["proj_1"]);
  });

  it("tells subscribers, so an open Entry screen drops the row straight away", () => {
    rememberRecentProject({ id: "proj_1", title: "a", sourceUrl: "https://a.test" });
    const listener = vi.fn();
    const unsubscribe = subscribeRecentProjects(listener);
    try {
      forgetRecentProject("proj_1");
      expect(listener).toHaveBeenCalledTimes(1);
      expect(getRecentProjectsSnapshot()).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it("survives a storage that refuses to be written", () => {
    rememberRecentProject({ id: "proj_1", title: "a", sourceUrl: "https://a.test" });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      expect(() => forgetRecentProject("proj_1")).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });
});

describe("the recent-projects store", () => {
  beforeEach(() => {
    localStorage.clear();
    // The snapshot is cached on the stored JSON, so clearing between tests has
    // to be visible to it too.
    getRecentProjectsSnapshot();
  });

  it("hands `useSyncExternalStore` the same array until something changes", () => {
    const first = getRecentProjectsSnapshot();
    expect(getRecentProjectsSnapshot()).toBe(first);

    rememberRecentProject({ id: "proj_1", title: "a", sourceUrl: "https://a.test" });

    const second = getRecentProjectsSnapshot();
    expect(second).not.toBe(first);
    expect(second.map((p) => p.id)).toEqual(["proj_1"]);
    expect(getRecentProjectsSnapshot()).toBe(second);
  });

  it("reports nothing on the server, where there is no browser to have opened anything", () => {
    rememberRecentProject({ id: "proj_1", title: "a", sourceUrl: "https://a.test" });

    expect(getServerRecentProjects()).toEqual([]);
  });

  it("notifies subscribers when a project is remembered, and stops on unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRecentProjects(listener);

    rememberRecentProject({ id: "proj_1", title: "a", sourceUrl: "https://a.test" });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    rememberRecentProject({ id: "proj_2", title: "b", sourceUrl: "https://b.test" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("refreshes when another tab writes the key", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRecentProjects(listener);
    try {
      window.dispatchEvent(new StorageEvent("storage", { key: RECENT_PROJECTS_KEY }));
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });
});

describe("sourceUrlHost", () => {
  it("returns the host of an absolute URL", () => {
    expect(sourceUrlHost("https://nimbus.app/pricing")).toBe("nimbus.app");
  });

  it("keeps a non-default port", () => {
    expect(sourceUrlHost("http://localhost:8080/a")).toBe("localhost:8080");
  });

  it("falls back to the raw value when it cannot be parsed", () => {
    expect(sourceUrlHost("not a url")).toBe("not a url");
  });
});

describe("formatRelativeTime", () => {
  const now = AT("2026-09-18T12:00:00.000Z");

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["2026-09-18T11:59:30.000Z", "just now"],
    ["2026-09-18T11:40:00.000Z", "20m ago"],
    ["2026-09-18T10:00:00.000Z", "2h ago"],
    ["2026-09-16T12:00:00.000Z", "2d ago"],
  ])("formats %s as %s", (iso, expected) => {
    expect(formatRelativeTime(iso, now)).toBe(expected);
  });

  it("switches to a short date once a week has passed", () => {
    // Formatted in the runner's timezone, so the expectation is derived the
    // same way rather than hard-coded to a UTC calendar day.
    const iso = "2026-09-09T12:00:00.000Z";
    const expected = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(Date.parse(iso));

    expect(expected).toMatch(/^Sep \d+$/);
    expect(formatRelativeTime(iso, now)).toBe(expected);
  });

  it("never reports a future timestamp as a negative age", () => {
    expect(formatRelativeTime("2026-09-18T12:00:30.000Z", now)).toBe("just now");
  });

  it("returns an empty string for an unparseable timestamp", () => {
    expect(formatRelativeTime("whenever", now)).toBe("");
  });
});
