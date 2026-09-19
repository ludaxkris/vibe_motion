/**
 * Control Panel state machine.
 *
 * A hand-written, pure reducer (no XState dependency) for the four Control
 * Panel states from docs/build_plan.md: idle -> selected -> choosing -> tuning,
 * plus `auto`, the auto-generate result list (docs/design/README.md, `2k`).
 * `tuning` carries the `animationId` it is tuning, so the type itself makes an
 * animation-less tuning state unrepresentable.
 *
 * A state reached from the result list carries `returnTo: "auto"`, which is
 * what lets "‹" and Esc go back up to the list rather than out to `idle`. The
 * key is absent — never `undefined` — on a state that was not.
 *
 * This module knows nothing about the draft store: `SELECT`, `BACK` and
 * `REVERT` each carry the `draftAnimationId` for the element in play (looked up
 * by the caller from `draftState`) so the machine can decide, without reaching
 * into any other state, whether an element with an existing draft assignment
 * should land on `selected` or on `tuning`.
 */

export type PanelState =
  | { status: "idle" }
  | { status: "auto" }
  | { status: "selected"; vmId: string; returnTo?: "auto" }
  | { status: "choosing"; vmId: string; returnTo?: "auto" }
  | { status: "tuning"; vmId: string; animationId: string; returnTo?: "auto" };

export type PanelEvent =
  | { type: "SELECT"; vmId: string; draftAnimationId?: string }
  | { type: "DESELECT" }
  | { type: "CHOOSE_CUSTOM" }
  | { type: "PICK"; animationId: string }
  /** `draftAnimationId`: what the current element has, for the step out of `choosing`. */
  | { type: "BACK"; draftAnimationId?: string }
  | { type: "CLEAR" }
  /** `draftAnimationId`: what the current element has *after* the revert. */
  | { type: "REVERT"; draftAnimationId?: string }
  /** A page auto-generate (or Regenerate) run has been applied to the draft. */
  | { type: "AUTO_DONE" }
  /** The result list's "‹": the only way from `auto` out to `idle`. */
  | { type: "AUTO_CLOSE" }
  /** The tuning panel's "Change" link: back into the picker. */
  | { type: "CHANGE" };

export const initialPanelState: PanelState = { status: "idle" };

const AUTO: PanelState = { status: "auto" };

/** A state with an element in play. */
type ElementState = Exclude<PanelState, { status: "idle" } | { status: "auto" }>;

function hasElement(state: PanelState): state is ElementState {
  return state.status !== "idle" && state.status !== "auto";
}

/** `{ returnTo: "auto" }` to spread into the next state, or nothing at all. */
function carryReturnTo(state: PanelState): { returnTo?: "auto" } {
  return hasElement(state) && state.returnTo === "auto" ? { returnTo: "auto" } : {};
}

/**
 * Pure and total: every (state, event) pair returns a `PanelState`. An event
 * that does not apply to the current state returns `state` unchanged — by
 * identity (`===`), not just by value, so a store built on this (Zustand's
 * `set`) never re-renders subscribers over a no-op.
 *
 * - `SELECT` lands on `selected { vmId }`, or `tuning { vmId, animationId }`
 *   when `draftAnimationId` is given (the element already has a draft
 *   assignment) — from any current state. Reselecting the *same* element
 *   with no draft is a no-op (identity): it must not collapse `choosing` or
 *   `tuning` back down to `selected`, since nothing about the element
 *   actually changed. Reselecting it *with* the draft it is already being
 *   tuned on is a no-op for the same reason. From `auto`, or from a state
 *   that has `returnTo: "auto"`, the new state carries `returnTo: "auto"`;
 *   the same-element identity checks compare `returnTo` too.
 * - `DESELECT` returns to `idle` from any state with an element in play — or
 *   to `auto` when that state has `returnTo: "auto"`. From `auto` itself it is
 *   a no-op (identity): a background click or Esc must not throw the list
 *   away, since the only way back would be Regenerate, which re-rolls.
 * - `CHOOSE_CUSTOM` only applies from `selected` -> `choosing`.
 * - `PICK` only applies from `choosing` -> `tuning`.
 * - `CHANGE` only applies from `tuning` -> `choosing` (the "Change" link).
 * - `BACK` means "up one level". From `tuning`/`selected` with
 *   `returnTo: "auto"` that is the result list. Otherwise it walks
 *   tuning -> choosing -> (tuning | selected) as it always has (`tuning` ->
 *   `choosing` is kept for compatibility; "Change" now says `CHANGE`), and is
 *   a no-op elsewhere. Out of `choosing` it lands back on `tuning` when the
 *   element still has a draft assignment (`draftAnimationId`), because
 *   "Change" then "‹" is a cancelled re-pick, not a removal — without it an
 *   animated element is stranded on a panel that reads "No animation yet".
 * - `CLEAR` drops back to `selected { vmId }` from `choosing`/`tuning`
 *   (used when the draft assignment for the current element is removed); a
 *   no-op from `idle`, `auto` or `selected` (already there — nothing to clear
 *   back from).
 * - `REVERT` follows the element the panel is on after the draft is thrown
 *   away: `tuning` when it still has an assignment, `selected` when the revert
 *   took it away, `idle` untouched (docs/design/README.md, "Interactions").
 *   From `auto` it lands on `idle`: the generated assignments are gone.
 * - `CHOOSE_CUSTOM`, `PICK`, `CHANGE`, `CLEAR`, `REVERT` and `BACK` out of
 *   `choosing` all preserve `returnTo`.
 * - `AUTO_DONE` lands on `auto` from `idle` (identity when already `auto`).
 *   From `selected`/`choosing`/`tuning` the panel does not move — the query
 *   can take seconds, and if the designer selected something meanwhile the
 *   draft is applied but the panel is not yanked away and the unsaved guard
 *   is not bypassed — it only gains `returnTo: "auto"`.
 * - `AUTO_CLOSE` leaves `auto` for `idle`; a no-op elsewhere.
 */
export function transition(state: PanelState, event: PanelEvent): PanelState {
  switch (event.type) {
    case "SELECT": {
      const returnTo =
        state.status === "auto" ? ({ returnTo: "auto" } as const) : carryReturnTo(state);
      const sameElement =
        hasElement(state) && state.vmId === event.vmId && state.returnTo === returnTo.returnTo;

      if (event.draftAnimationId) {
        // Reselecting the element already being tuned, on the same animation,
        // is the same no-op as reselecting one with no draft: a fresh object
        // would re-render every `panel` subscriber over a state that did not
        // change (Phase 4's bridge re-reports the selection on every message).
        return sameElement &&
          state.status === "tuning" &&
          state.animationId === event.draftAnimationId
          ? state
          : {
              status: "tuning",
              vmId: event.vmId,
              animationId: event.draftAnimationId,
              ...returnTo,
            };
      }

      return sameElement ? state : { status: "selected", vmId: event.vmId, ...returnTo };
    }

    case "DESELECT":
      if (!hasElement(state)) return state;
      return state.returnTo === "auto" ? AUTO : { status: "idle" };

    case "CHOOSE_CUSTOM":
      return state.status === "selected"
        ? { status: "choosing", vmId: state.vmId, ...carryReturnTo(state) }
        : state;

    case "PICK":
      return state.status === "choosing"
        ? {
            status: "tuning",
            vmId: state.vmId,
            animationId: event.animationId,
            ...carryReturnTo(state),
          }
        : state;

    case "CHANGE":
      return state.status === "tuning"
        ? { status: "choosing", vmId: state.vmId, ...carryReturnTo(state) }
        : state;

    case "BACK":
      if (state.status === "tuning") {
        return state.returnTo === "auto" ? AUTO : { status: "choosing", vmId: state.vmId };
      }
      if (state.status === "selected") return state.returnTo === "auto" ? AUTO : state;
      if (state.status === "choosing") {
        return event.draftAnimationId
          ? {
              status: "tuning",
              vmId: state.vmId,
              animationId: event.draftAnimationId,
              ...carryReturnTo(state),
            }
          : { status: "selected", vmId: state.vmId, ...carryReturnTo(state) };
      }
      return state;

    case "CLEAR":
      return state.status === "choosing" || state.status === "tuning"
        ? { status: "selected", vmId: state.vmId, ...carryReturnTo(state) }
        : state;

    case "REVERT": {
      if (state.status === "idle") return state;
      if (state.status === "auto") return { status: "idle" };

      if (event.draftAnimationId) {
        return state.status === "tuning" && state.animationId === event.draftAnimationId
          ? state
          : {
              status: "tuning",
              vmId: state.vmId,
              animationId: event.draftAnimationId,
              ...carryReturnTo(state),
            };
      }

      return state.status === "selected"
        ? state
        : { status: "selected", vmId: state.vmId, ...carryReturnTo(state) };
    }

    case "AUTO_DONE":
      if (state.status === "idle") return AUTO;
      if (state.status === "auto" || state.returnTo === "auto") return state;
      return { ...state, returnTo: "auto" };

    case "AUTO_CLOSE":
      return state.status === "auto" ? { status: "idle" } : state;

    default:
      return state;
  }
}
