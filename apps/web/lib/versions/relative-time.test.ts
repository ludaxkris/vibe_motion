import { describe, expect, it } from "vitest";

import { relativeTime } from "./relative-time";

const NOW = new Date("2026-09-18T12:00:00.000Z"); // a Friday

describe("relativeTime", () => {
  it("says 'just now' under a minute ago", () => {
    expect(relativeTime("2026-09-18T11:59:30.000Z", NOW)).toBe("just now");
  });

  it("counts minutes under an hour ago", () => {
    expect(relativeTime("2026-09-18T11:48:00.000Z", NOW)).toBe("12m ago");
  });

  it("counts hours under a day ago", () => {
    expect(relativeTime("2026-09-18T10:00:00.000Z", NOW)).toBe("2h ago");
  });

  it("names the weekday under a week ago", () => {
    // Monday, four days before the Friday `NOW`.
    expect(relativeTime("2026-09-14T09:00:00.000Z", NOW)).toBe("Mon");
  });

  it("falls back to month and day at a week or older", () => {
    expect(relativeTime("2026-09-03T09:00:00.000Z", NOW)).toBe("Sep 3");
  });
});
