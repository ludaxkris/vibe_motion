import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "./use-clipboard";

/**
 * jsdom has neither `navigator.clipboard` nor `document.execCommand`, and Node
 * supplies neither — so each path is installed explicitly by the test that
 * wants it, and taken away again afterwards.
 */
function stubAsyncClipboard(writeText: (text: string) => Promise<void>) {
  const spy = vi.fn(writeText);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: spy },
    configurable: true,
  });
  return spy;
}

function stubExecCommand(result: boolean | (() => boolean)) {
  const spy = vi.fn((command: string) => {
    expect(command).toBe("copy");
    return typeof result === "function" ? result() : result;
  });
  Object.defineProperty(document, "execCommand", { value: spy, configurable: true });
  return spy;
}

function clearStubs() {
  for (const [target, key] of [
    [navigator, "clipboard"],
    [document, "execCommand"],
  ] as const) {
    if (key in target) delete (target as unknown as Record<string, unknown>)[key];
  }
}

afterEach(() => {
  clearStubs();
  vi.restoreAllMocks();
});

describe("copyText", () => {
  it("uses navigator.clipboard when the browser has it", async () => {
    const writeText = stubAsyncClipboard(async () => {});
    const execCommand = stubExecCommand(true);

    await expect(copyText("body { }")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("body { }");
    // The fallback is a fallback: it does not also run.
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("falls back to a hidden textarea when there is no async clipboard", async () => {
    const execCommand = stubExecCommand(true);

    await expect(copyText("the css")).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledOnce();
    // Nothing is left in the document, and the reader's focus is where it was.
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("selects the whole text before asking the document to copy it", async () => {
    let selected: string | undefined;
    stubExecCommand(() => {
      const area = document.querySelector("textarea");
      selected = area?.value.slice(area.selectionStart ?? 0, area.selectionEnd ?? 0);
      return true;
    });

    await copyText("line one\nline two");

    expect(selected).toBe("line one\nline two");
  });

  it("falls back when the async clipboard rejects — a denied permission is not a copy", async () => {
    stubAsyncClipboard(async () => {
      throw new DOMException("Write permission denied.", "NotAllowedError");
    });
    const execCommand = stubExecCommand(true);

    await expect(copyText("x")).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledOnce();
  });

  it("is false when the document refuses the copy", async () => {
    stubExecCommand(false);

    await expect(copyText("x")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("is false, and does not throw, when the browser offers neither way", async () => {
    await expect(copyText("x")).resolves.toBe(false);
  });

  it("is false, not a throw, when the document itself misbehaves", async () => {
    stubExecCommand(true);
    vi.spyOn(document, "createElement").mockImplementation(() => {
      throw new Error("no elements for you");
    });

    await expect(copyText("x")).resolves.toBe(false);
  });

  it("puts focus back where it was", async () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    stubExecCommand(true);

    await copyText("x");

    expect(document.activeElement).toBe(input);
    input.remove();
  });
});
