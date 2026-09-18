# pr_screenshot

Long-lived orphan branch holding screenshots captured by the Vibe Motion `screenshot-runner` subagent.
It shares no history with `main`. Working branches never contain screenshot files.

Layout:

```
<pr-number>/<short-sha>/<name>.png
<pr-number>/<short-sha>/manifest.json
baseline/<name>.png
```

PR comments link to images by raw URL pinned to a commit on this branch, so links stay valid as long as this branch exists. Do not delete or rewrite it.
