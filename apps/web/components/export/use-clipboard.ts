"use client";

/**
 * The async Clipboard API. Absent on `http://` origins other than localhost,
 * and its promise rejects when the permission is denied or the document is not
 * focused — neither of which is a copy, so both fall through to the textarea.
 */
async function copyViaClipboardApi(text: string): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
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

  // Everything from here on is inside the guard, the element's creation
  // included: `copyText` promises never to throw, and a caller that turned a
  // throw into an unhandled rejection would show no toast at all.
  let textarea: HTMLTextAreaElement | undefined;
  const previouslyFocused = document.activeElement;
  try {
    textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.tabIndex = -1;
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.cssText =
      "position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.append(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return execCommand.call(document, "copy") === true;
  } catch {
    return false;
  } finally {
    textarea?.remove();
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
