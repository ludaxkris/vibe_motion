/**
 * A CSS declaration-list parser, just big enough for the catalog's
 * `baseStyles` (`packages/animation-catalog/schema.json`: "Optional
 * declarations applied to the element whenever this animation is assigned,
 * e.g. `transform-origin: center; backface-visibility: hidden;`").
 *
 * Deliberately not postcss: `lib/runtime-css` runs in the browser (the bridge
 * and the draft store, Phase 4) and postcss is a build/test-only dependency
 * here — shipping a CSS parser to every editor session to read two declarations
 * is not a trade worth making. What this has to get right is only what a
 * declaration list can contain: `;` and `:` inside `()` (`linear-gradient(...)`,
 * `url(data:…;base64,…)`) or inside a quoted string are part of the value, not
 * separators.
 *
 * No React, no DOM — same contract as the rest of `lib/runtime-css`.
 */

/** Characters that open a nesting level a separator must not be read inside. */
const OPENERS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };

/**
 * Split `css` on every top-level occurrence of `separator`, ignoring any that
 * sits inside brackets or a quoted string. Only the first `limit` splits are
 * made (`limit: 1` gives `["property", "rest of the value"]`).
 */
function splitTopLevel(css: string, separator: string, limit = Infinity): string[] {
  const parts: string[] = [];
  const stack: string[] = [];
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < css.length; i += 1) {
    const char = css[i];

    if (quote !== null) {
      if (char === "\\") {
        i += 1; // the escaped character is part of the string, whatever it is
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    } else if (OPENERS[char]) {
      stack.push(OPENERS[char]);
    } else if (stack.length > 0 && char === stack[stack.length - 1]) {
      stack.pop();
    } else if (char === separator && stack.length === 0 && parts.length < limit) {
      parts.push(css.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(css.slice(start));
  return parts;
}

/**
 * `"transform-origin: center; backface-visibility: hidden;"` →
 * `{ "transform-origin": "center", "backface-visibility": "hidden" }`.
 *
 * Property names and values are kept exactly as written (custom properties
 * included); a fragment with no `:` or an empty half is dropped, and a repeated
 * property takes its last value, as a browser would.
 */
export function parseDeclarations(css: string): Record<string, string> {
  const declarations: Record<string, string> = {};

  for (const fragment of splitTopLevel(css, ";")) {
    const [property, value] = splitTopLevel(fragment, ":", 1);
    if (value === undefined) continue;
    const name = property.trim();
    const setting = value.trim();
    if (!name || !setting) continue;
    declarations[name] = setting;
  }

  return declarations;
}
