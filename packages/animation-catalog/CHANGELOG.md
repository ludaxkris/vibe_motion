# Animation catalog changelog

Files under `versions/` are immutable once merged to `main`. Every change is a new version file, a bump of `current`, and an entry here. Semver: **patch** = metadata only (name, description, category, labels); **minor** = new animations, or new params (standard or cssVar-backed) whose default reproduces the previous rendering — this may add `var(--vm-x)` references to keyframes/baseStyles; **major** = changed rendering at default params, removed animations, renamed or removed params.

## 1.1.0 — 2026-09-18

Minor: adds `fillMode` as a sixth **standard** param (maps to `animation-fill-mode`) — mandatory on every entry from this version onward, not optional, appended right after the last of `duration`/`delay`/`easing`/`iteration`/`direction` and before any animation-specific params. This is still a MINOR bump, not a MAJOR one: nothing about any existing (id, param, keyframes, trigger) changes, a param is only ever added here, never renamed or removed, and every field other than `version` and the new `fillMode` param is byte-for-byte identical to 1.0.0.

Without it, an entrance animation with a nonzero `delay` shows the element in its final (post-animation) state during the delay window, because the browser default fill-mode is `none`. Defaults chosen per category, to preserve the 1.0.0 visual result:

- `entrance` → `both` (holds the pre-animation state through the delay, then the post-animation state after finishing)
- `exit`, `hover` → `forwards` (stays in the post-animation state instead of snapping back; for `hover` in particular, `both` would apply the *backwards* fill during any `delay`, which would clobber the host element's own box-shadow/transform in that window — `forwards` avoids touching anything before the transition starts)
- `attention`, `continuous` → `none` (these all return to the resting state at 0%/100%, so holding either end changes nothing)
- `emphasis` → `none`, except `highlight` and `underline-sweep` → `forwards`: both are non-looping (no `iteration` param, so `animation-iteration-count` defaults to 1) and their `to` state (a highlight color; a fully grown underline) differs from the resting state (transparent; no underline) — `none` would make the animation appear to instantly revert the moment it finishes, which is not the 1.0.0 visual result. `glow` stays `none`: it loops (`iteration: infinite`) and its 0%/100% keyframes already match the resting state.

`current` → `1.1.0`.

## 1.0.0 — 2026-09-18

Initial catalog. 26 CSS-only animations across six categories.

- entrance: fade-in, fade-in-up, fade-in-down, fade-in-left, fade-in-right, scale-in, slide-in-up, blur-in, flip-in-x
- exit: fade-out, fade-out-down, scale-out
- attention: pulse, shake, bounce, wobble, heartbeat
- emphasis: glow, highlight, underline-sweep
- continuous: spin, float, shimmer
- hover: hover-lift, hover-grow, hover-tilt
