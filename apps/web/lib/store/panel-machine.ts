/**
 * Control Panel state machine.
 *
 * A hand-written, pure reducer (no XState dependency) for the four Control
 * Panel states from docs/build_plan.md: idle -> selected -> choosing -> tuning.
 * `tuning` carries the `animationId` it is tuning, so the type itself makes an
 * animation-less tuning state unrepresentable.
 *
 * This module knows nothing about the draft store: `SELECT`, `BACK` and
 * `REVERT` each carry the `draftAnimationId` for the element in play (looked up
 * by the caller from `draftState`) so the machine can decide, without reaching
 * into any other state, whether an element with an existing draft assignment
 * should land on `selected` or on `tuning`.
 */

export type PanelState =
  | { status: "idle" }
  | { status: "selected"; vmId: string }
  | { status: "choosing"; vmId: string }
  | { status: "tuning"; vmId: string; animationId: string };

export type PanelEvent =
  | { type: "SELECT"; vmId: string; draftAnimationId?: string }
  | { type: "DESELECT" }
  | { type: "CHOOSE_CUSTOM" }
  | { type: "PICK"; animationId: string }
  /** `draftAnimationId`: what the current element has, for the step out of `choosing`. */
  | { type: "BACK"; draftAnimationId?: string }
  | { type: "CLEAR" }
  /** `draftAnimationId`: what the current element has *after* the revert. */
  | { type: "REVERT"; draftAnimationId?: string };

export const initialPanelState: PanelState = { status: "idle" };

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
 *   tuned on is a no-op for the same reason.
 * - `DESELECT` returns to `idle` from any non-idle state.
 * - `CHOOSE_CUSTOM` only applies from `selected` -> `choosing`.
 * - `PICK` only applies from `choosing` -> `tuning`.
 * - `BACK` walks tuning -> choosing -> (tuning | selected); a no-op elsewhere.
 *   Out of `choosing` it lands back on `tuning` when the element still has a
 *   draft assignment (`draftAnimationId`), because "Change" then "‹" is a
 *   cancelled re-pick, not a removal — without it an animated element is
 *   stranded on a panel that reads "No animation yet".
 * - `CLEAR` drops back to `selected { vmId }` from `choosing`/`tuning`
 *   (used when the draft assignment for the current element is removed); a
 *   no-op from `idle` or `selected` (already there — nothing to clear back
 *   from).
 * - `REVERT` follows the element the panel is on after the draft is thrown
 *   away: `tuning` when it still has an assignment, `selected` when the revert
 *   took it away, `idle` untouched (docs/design/README.md, "Interactions").
 */
export function transition(state: PanelState, event: PanelEvent): PanelState {
  switch (event.type) {
    case "SELECT": {
      const sameElement = state.status !== "idle" && state.vmId === event.vmId;

      if (event.draftAnimationId) {
        // Reselecting the element already being tuned, on the same animation,
        // is the same no-op as reselecting one with no draft: a fresh object
        // would re-render every `panel` subscriber over a state that did not
        // change (Phase 4's bridge re-reports the selection on every message).
        return sameElement &&
          state.status === "tuning" &&
          state.animationId === event.draftAnimationId
          ? state
          : { status: "tuning", vmId: event.vmId, animationId: event.draftAnimationId };
      }

      return sameElement ? state : { status: "selected", vmId: event.vmId };
    }

    case "DESELECT":
      return state.status === "idle" ? state : { status: "idle" };

    case "CHOOSE_CUSTOM":
      return state.status === "selected" ? { status: "choosing", vmId: state.vmId } : state;

    case "PICK":
      return state.status === "choosing"
        ? { status: "tuning", vmId: state.vmId, animationId: event.animationId }
        : state;

    case "BACK":
      if (state.status === "tuning") return { status: "choosing", vmId: state.vmId };
      if (state.status === "choosing") {
        return event.draftAnimationId
          ? { status: "tuning", vmId: state.vmId, animationId: event.draftAnimationId }
          : { status: "selected", vmId: state.vmId };
      }
      return state;

    case "CLEAR":
      return state.status === "choosing" || state.status === "tuning"
        ? { status: "selected", vmId: state.vmId }
        : state;

    case "REVERT": {
      if (state.status === "idle") return state;

      if (event.draftAnimationId) {
        return state.status === "tuning" && state.animationId === event.draftAnimationId
          ? state
          : { status: "tuning", vmId: state.vmId, animationId: event.draftAnimationId };
      }

      return state.status === "selected" ? state : { status: "selected", vmId: state.vmId };
    }

    default:
      return state;
  }
}
