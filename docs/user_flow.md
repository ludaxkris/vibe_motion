# Vibe Motion — User Flow (v0)

Status: DRAFT for review · Last updated: 2026-09-18

The designer's journey end to end: capture a page, add animation, save a version, recall an earlier version, export to their machine. Screens map to routes in [build_plan.md](build_plan.md) Phase 3; data behaviour maps to [architecture.md](architecture.md).

## 1. End-to-end journey

```mermaid
flowchart TD
  start([Designer opens Vibe Motion]) --> home["/ · Enter page URL"]
  home -->|"Submit"| cloning["Cloning…<br/>fetch, sanitise, tag elements"]
  cloning -->|"error: unreachable, too large, blocked host"| homeErr["Show reason, keep URL in field"] --> home
  cloning -->|"ok → project + v0"| editor["/p/{id} · Editor<br/>preview 75% · Control Panel 25%<br/>current = v0, no unsaved changes"]

  editor --> animate["Add animation (§2)"]
  animate --> unsaved["Editor · unsaved changes ●<br/>Save enabled"]
  unsaved -->|"more edits"| animate
  unsaved -->|"Save"| save["Save (§3)"] --> editor
  editor -->|"open History"| history["Recall a version (§4)"] --> editor
  editor -->|"Export"| export["Publish / export (§5)"] --> done([Files on designer's machine])
  unsaved -->|"Export or History"| guard{"Save or discard<br/>unsaved changes?"}
  guard -->|"Save"| save
  guard -->|"Discard"| editor
  guard -->|"Cancel"| unsaved
```

## 2. Adding animation

```mermaid
flowchart TD
  idle["Control Panel · idle<br/>'Click any element to begin'<br/>+ Auto-generate page button<br/>+ prompt box"]
  idle -->|"hover element"| hover["Element outlined"] --> idle
  idle -->|"click element"| selected["Panel · selected<br/>element highlighted + label<br/>[Generate] [Custom]"]
  idle -->|"Auto-generate"| auto["Mock agent picks animations for<br/>headings, text, images, links/buttons, cards (as one unit)<br/>staggered by document order"] --> tuningMany["Panel · result list<br/>one row per generated element<br/>[Regenerate] [Replay all] [Remove all]<br/>row click → tuning, ‹ returns to the list"]

  selected -->|"Generate"| gen["Mock agent picks one animation<br/>(random from catalog, light heuristics)"] --> tuning
  selected -->|"Custom"| choosing["Panel · choosing<br/>catalog grouped by category<br/>hover a card → preview on element"]
  choosing -->|"pick"| tuning
  choosing -->|"back"| selected
  selected -->|"click elsewhere / Esc"| idle

  tuning["Panel · tuning<br/>animation name · trigger (load/hover/in-view)<br/>duration · delay · easing · iteration<br/>animation-specific knobs (distance, scale, angle)<br/>[Replay] [Change animation] [Remove]"]
  tuning -->|"drag a slider"| live["Preview updates same frame<br/>draft state updated · unsaved ●"] --> tuning
  tuning -->|"Change animation"| choosing
  tuning -->|"Remove"| selected
  tuning -->|"click another element"| selected
  tuningMany -->|"click an element"| tuning
```

Notes

- Nothing in this section calls the API. Every change updates the draft in the browser and the preview iframe.
- "Generate" and "Auto-generate" are the mock agent in v0. Auto-generate and Regenerate keep hand-tuned work and re-roll only what the agent made and the user has not touched; switching elements away from untouched agent work never raises the unsaved-changes dialog, while the top bar's Unsaved indicator still shows. The prompt box is present and passed into the agent context but ignored by the mock; a tooltip says so.
- "Help" is reachable from the panel header at any time and opens `/help` in a new tab so the draft is untouched.

## 3. Saving a version

```mermaid
sequenceDiagram
  actor D as Designer
  participant E as Editor (browser)
  participant A as api

  Note over E: unsaved ● · Save enabled
  D->>E: click Save
  E->>E: diff = delta(currentVersionState, draftState)
  E-->>D: Save dialog · label prefilled from diff<br/>("Fade In Up on h1, Pulse on .cta")
  D->>E: edit label (optional), confirm
  E->>A: POST /projects/{id}/versions { parentVersionId, diff, label }
  alt parent is still current
    A-->>E: 201 { version v(n+1) }
    E->>E: currentVersionState = draftState · unsaved cleared
    E-->>D: toast "Saved v(n+1)" · history list gains an entry
  else another tab saved first
    A-->>E: 409 { currentVersion }
    E-->>D: conflict dialog: "v(n+1) was saved somewhere else" — Apply my changes on top · Discard my changes · Keep editing
    D->>E: Apply my changes on top
    E->>E: reload v(n+1) state, replay draft's own diff on top (rebase)
    E-->>D: Save dialog reopens, forked from v(n+1) · D confirms Save again (never an automatic retry)
  end
```

- Versions exist only through Save. Sliding a control fifty times and saving once yields one version.
- Each version stores only the diff from its parent, so the history list can show exactly what changed in each entry.

## 4. Recalling a previous version

```mermaid
flowchart TD
  editing["Editor · editing<br/>current = v5"] -->|"open History"| list["History panel<br/>v5 (current) · v4 · v3 · v2 · v1 · v0<br/>each with label, time, change summary"]
  list -->|"unsaved changes?"| guard{"Save or discard first"}
  guard -->|"Save"| list
  guard -->|"Discard"| list
  guard -->|"Cancel"| editing
  list -->|"click v3"| viewing["Editor · viewing v3 (read-only)<br/>preview reloads with stateAt(v3)<br/>banner: 'Viewing v3 — Restore · Back to v5'<br/>controls disabled"]
  viewing -->|"click v2"| viewing
  viewing -->|"Back to current"| editing
  viewing -->|"Restore"| restore["POST /versions/v3/restore<br/>creates v6 whose diff returns state to v3"] --> editing6["Editor · editing<br/>current = v6 (state == v3)<br/>history: v6 'Restored v3' · v5 · v4 · v3 …"]
  viewing -->|"Export"| export["Export this version (§5)<br/>versionId = v3, no restore required"]
```

- Restoring never deletes or rewrites history. v4 and v5 remain and can be viewed or restored later.
- Any saved version can be exported directly while viewing it, without restoring.
- Pressing Esc, or switching away from the History tab, returns to the current version the same way "Back to current" does. Save and Cancel are hidden (not merely disabled) for the whole time the editor is viewing — there is no draft of the viewer's own to save or cancel.

## 5. Publishing (export) to the local machine

```mermaid
flowchart TD
  start["Editor · Export button"] -->|"unsaved changes?"| guard{"Save first?"}
  guard -->|"Save"| panel
  guard -->|"Cancel"| back([return to editor])
  start -->|"no unsaved changes"| panel

  panel["Export panel · targets versionId (current or the one being viewed)<br/>tabs: index.html · vibe-motion.css · vibe-motion.js<br/>mode: Full page | Snippet for selected element"]
  panel -->|"Copy tab"| copied["Clipboard · toast 'Copied CSS'"] --> panel
  panel -->|"Download .zip"| zip["vibe-motion-{project}-v{n}.zip<br/>index.html · vibe-motion.css · vibe-motion.js (only if in-view trigger used) · README.txt"]
  zip --> local([Files saved to designer's Downloads])
  panel -->|"Snippet mode"| snippet["CSS + class name for one element<br/>paste into an existing site without replacing HTML"] --> copied
```

`README.txt` in the zip explains the three files, how to link the CSS and JS, and which classes were added to which elements.

## 6. State summary

| Editor mode | Preview shows | Controls | Save | Export target |
|---|---|---|---|---|
| editing, clean | current version | enabled | disabled | current |
| editing, unsaved ● | draft | enabled | enabled | prompts to save |
| viewing vN | stateAt(vN) | disabled | hidden | vN |
| cloning | spinner | none | none | none |
