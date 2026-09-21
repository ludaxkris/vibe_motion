/** The only content type this module ever puts on a blob URL. */
export const ZIP_CONTENT_TYPE = "application/zip";

/**
 * Revoking in the same turn as the click is what breaks the download in some
 * browsers; a macrotask later the navigation has already taken its reference.
 */
const REVOKE_DELAY_MS = 0;

/**
 * Save `data` to the reader's disk under `fileName`.
 *
 * Returns whether the browser could be asked at all, so the caller can say so
 * rather than leave a button that silently did nothing.
 *
 * A `text/html` blob would be a document on *this* origin, able to reach into
 * the editor — plan §1.7 says the export tab never builds one. Exported HTML
 * travels inside the zip, and is shown as text (`code-block.tsx`).
 */
export function downloadFile({
  fileName,
  data,
  contentType,
}: {
  fileName: string;
  data: BlobPart;
  contentType: string;
}): boolean {
  if (contentType.split(";")[0]?.trim().toLowerCase() === "text/html") {
    throw new TypeError(
      "Vibe Motion never creates a text/html blob URL on the app origin (plan §1.7).",
    );
  }
  if (typeof document === "undefined") return false;

  const createObjectURL = URL.createObjectURL as typeof URL.createObjectURL | undefined;
  if (typeof createObjectURL !== "function") return false;

  const url = createObjectURL.call(URL, new Blob([data], { type: contentType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  // Attached on purpose: a detached anchor's activation does not follow the
  // link in every browser.
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }

  const revokeObjectURL = URL.revokeObjectURL as typeof URL.revokeObjectURL | undefined;
  if (typeof revokeObjectURL === "function") {
    setTimeout(() => revokeObjectURL.call(URL, url), REVOKE_DELAY_MS);
  }
  return true;
}

/** `buildZip`'s bytes, saved as a zip. */
export function downloadZip(fileName: string, bytes: Uint8Array): boolean {
  // `zipSync` types its result as `Uint8Array<ArrayBufferLike>`, which a Blob
  // will not take because such a view *could* be backed by a SharedArrayBuffer.
  // It never is here; a view over the very same bytes, no copy, satisfies both.
  const data = new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
  return downloadFile({ fileName, data, contentType: ZIP_CONTENT_TYPE });
}
