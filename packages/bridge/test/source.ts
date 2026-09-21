/**
 * Reading one function out of a classic-script source file.
 *
 * `src/vm-bridge.js` and `src/vibe-motion-export.js` are module-free IIFEs with nothing exported —
 * that is the point of both — so a test that wants to exercise or compare one helper has to lift
 * it out of the text. Shared by `export-script.test.ts` (which evaluates a helper) and
 * `in-view-parity.test.ts` (which compares two copies of one).
 */

/** `function <name>(…) { … }` from `source`, brace-matched. */
export function functionSource(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no function ${name} in this file`);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`function ${name} is not brace-balanced`);
}

/**
 * One top-level function as a callable, with the script's module constants supplied.
 *
 * Only for helpers that close over nothing else; `IN_VIEW_THRESHOLD` is the only constant these
 * pure helpers read, and it is passed in rather than parsed so a test cannot accidentally prove
 * the file agrees with itself.
 */
export function callable(source: string, name: string, threshold = 0.2): (...args: number[]) => number {
  const body = functionSource(source, name);
  return new Function(
    `"use strict"; var IN_VIEW_THRESHOLD = ${threshold}; ${body} return ${name};`,
  )() as (...args: number[]) => number;
}
