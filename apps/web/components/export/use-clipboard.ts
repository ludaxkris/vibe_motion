"use client";

import { useCallback } from "react";

/**
 * The async Clipboard API. Absent on `http://` origins other than localhost,
 * and its promise rejects when the permission is denied or the document is not
 * focused — neither of which is a copy, so both fall through to the textarea.
 */
async function copyViaClipboardApi(text: string): Promise<boolean> {
  const clipboard: Clipboard | undefined = navigator.clipboard;
  if (typeof clipboard?.writeText !== "function") return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The pre-2018 way, still the only one in some browsers: select the text in an
 * off-screen textarea and ask the document to copy the selection.
 *
 * Off-screen rather than `display: none` or `hidden` — a textarea the layout
 * does not have cannot hold a selection, so the copy would quietly do nothing.
 */
function copyViaTextarea(text: string): boolean {
  if (typeof document === "undefined") return false;
  const execCommand = document.execCommand as ((command: string) => boolean) | undefined;
  if (typeof execCommand !== "function") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.cssText =
    "position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none";
  const previouslyFocused = document.activeElement;
  document.body.append(textarea);

  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return execCommand.call(document, "copy") === true;
  } catch {
    return false;
  } finally {
    textarea.remove();
    // Taking focus to copy and not giving it back would strand a keyboard
    // reader on `<body>`.
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
  }
}

/**
 * Put `text` on the clipboard, and say whether it got there.
 *
 * Never throws: a browser with neither route (jsdom, an insecure origin with
 * `execCommand` removed) answers `false`, which is what the Export tab turns
 * into a toast rather than a silent no-op.
 */
export async function copyText(text: string): Promise<boolean> {
  if (await copyViaClipboardApi(text)) return true;
  return copyViaTextarea(text);
}

/** `const copy = useClipboard(); await copy(bundle.css)`. */
export function useClipboard(): (text: string) => Promise<boolean> {
  return useCallback((text: string) => copyText(text), []);
}
