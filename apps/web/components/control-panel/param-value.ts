/**
 * Pure numeric <-> CSS-string helpers for the tuning sliders.
 *
 * Catalog param values are CSS strings with units (`"600ms"`, `"24px"`,
 * `"1.2"`, `"45deg"`, `"50%"`); `min`/`max`/`step` are strings in the same
 * unit. Sliders operate on the numeric part only and write the unit straight
 * back on change.
 */

/** Splits a CSS value string into its numeric amount and trailing unit (`""` for a bare number). */
export function splitValue(value: string): { amount: number; unit: string } {
  const match = /^(-?\d*\.?\d+)(.*)$/.exec(value.trim());
  if (!match) return { amount: 0, unit: "" };
  return { amount: Number(match[1]), unit: match[2].trim() };
}

/** Joins a numeric amount and a unit back into the CSS value string form. */
export function joinValue(amount: number, unit: string): string {
  return `${amount}${unit}`;
}
