# Animation catalog changelog

Files under `versions/` are immutable once merged to `main`. Every change is a new version file, a bump of `current`, and an entry here. Semver: patch = metadata only (name, description, category, labels); minor = new animations or new optional params; major = changed keyframes, removed animations, renamed or removed params.

## 1.0.0 — 2026-09-18

Initial catalog. 26 CSS-only animations across six categories.

- entrance: fade-in, fade-in-up, fade-in-down, fade-in-left, fade-in-right, scale-in, slide-in-up, blur-in, flip-in-x
- exit: fade-out, fade-out-down, scale-out
- attention: pulse, shake, bounce, wobble, heartbeat
- emphasis: glow, highlight, underline-sweep
- continuous: spin, float, shimmer
- hover: hover-lift, hover-grow, hover-tilt
