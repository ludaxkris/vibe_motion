/**
 * The Entry screen's URL field holds everything *after* `https://` — the
 * scheme is the field's static prefix (`docs/design/ui_kit/Entry.jsx`). These
 * are the pure string rules that keeps that illusion honest: what a paste does
 * to the value, what the value means when it is submitted, and how a URL is
 * labelled back to the user while it clones.
 */

/**
 * Drops the leading `https://` a paste brings with it, so the value lines up
 * with the prefix that is already on screen. `http://` is deliberately kept:
 * typing it is the only way to clone a plain-http page.
 */
export function stripHttpsScheme(value: string): string {
  return value.replace(/^https:\/\//i, "");
}

/**
 * The absolute http(s) URL `value` means, or `null` when it cannot be one.
 * A scheme-less value takes the prefix's `https://`.
 */
export function normalizeSourceUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parse = (candidate: string): string | null => {
    try {
      const url = new URL(candidate);
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  };

  // `https://ftp://x` is not a thing, so an explicit non-http(s) scheme has to
  // fail rather than fall through to the prefixed retry.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return parse(trimmed);
  return parse(`https://${trimmed}`);
}

/** `https://nimbus.app/pricing` → `nimbus.app/pricing`, the handoff's clone label. */
export function hostAndPath(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}${parsed.search}`;
  } catch {
    return url;
  }
}
