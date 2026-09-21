import { afterEach, describe, expect, it, vi } from "vitest";

import { ZIP_CONTENT_TYPE, downloadFile, downloadZip } from "./download";

/**
 * jsdom has no `URL.createObjectURL`, and Node 25 has an ambient one whose
 * presence is not something this module may rely on either way — so both are
 * installed explicitly for the test that wants them and removed after.
 */
function stubObjectUrl() {
  const created: Blob[] = [];
  const createObjectURL = vi.fn((blob: Blob) => {
    created.push(blob);
    return `blob:vitest/${created.length}`;
  });
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    value: createObjectURL,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: revokeObjectURL,
    configurable: true,
    writable: true,
  });
  return { created, createObjectURL, revokeObjectURL };
}

function removeObjectUrl() {
  for (const key of ["createObjectURL", "revokeObjectURL"] as const) {
    if (key in URL) delete (URL as unknown as Record<string, unknown>)[key];
  }
}

/**
 * jsdom treats a real anchor click as a navigation it has not implemented and
 * shouts about it, so the click is captured instead — which is also how the
 * anchor's own attributes are read back.
 */
function captureAnchorClick() {
  const clicked: HTMLAnchorElement[] = [];
  const spy = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
      // The anchor must still be in the document when it is activated: a
      // detached one never navigates in Firefox.
      expect(this.isConnected).toBe(true);
    });
  return { clicked, spy };
}

afterEach(() => {
  vi.restoreAllMocks();
  removeObjectUrl();
});

describe("downloadFile", () => {
  it("hands the browser a named blob URL and revokes it afterwards", async () => {
    const { created, revokeObjectURL } = stubObjectUrl();
    const { clicked } = captureAnchorClick();

    const ok = downloadFile({
      fileName: "vibe-motion-nimbus-v5.zip",
      data: new Uint8Array([1, 2, 3]),
      contentType: ZIP_CONTENT_TYPE,
    });

    expect(ok).toBe(true);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("vibe-motion-nimbus-v5.zip");
    expect(clicked[0].href).toBe("blob:vitest/1");
    expect(created[0].type).toBe("application/zip");
    // Nothing is left behind in the document.
    expect(document.querySelector("a[download]")).toBeNull();

    await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:vitest/1"));
  });

  it("refuses to put a text/html blob on this origin", () => {
    const { createObjectURL } = stubObjectUrl();

    expect(() =>
      downloadFile({ fileName: "index.html", data: "<h1>hi</h1>", contentType: "text/html" }),
    ).toThrow(/text\/html/);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("says no rather than throwing when the browser has no object URLs", () => {
    removeObjectUrl();
    const { clicked } = captureAnchorClick();

    expect(
      downloadFile({ fileName: "x.zip", data: new Uint8Array(), contentType: ZIP_CONTENT_TYPE }),
    ).toBe(false);
    expect(clicked).toHaveLength(0);
  });

  it("still downloads when the browser cannot revoke", () => {
    const { createObjectURL } = stubObjectUrl();
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
    const { clicked } = captureAnchorClick();

    expect(
      downloadFile({ fileName: "x.zip", data: new Uint8Array(), contentType: ZIP_CONTENT_TYPE }),
    ).toBe(true);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clicked).toHaveLength(1);
  });
});

describe("downloadZip", () => {
  it("is application/zip, never text/html", async () => {
    const { created, revokeObjectURL } = stubObjectUrl();
    captureAnchorClick();

    expect(downloadZip("vibe-motion-project-v1.zip", new Uint8Array([80, 75]))).toBe(true);

    expect(created[0].type).toBe("application/zip");
    await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledOnce());
  });
});
