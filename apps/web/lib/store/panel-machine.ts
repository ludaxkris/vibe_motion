/**
 * Control Panel state machine.
 *
 * A hand-written, pure reducer (no XState dependency) for the four Control
 * Panel states from docs/build_plan.md: idle -> selected -> choosing -> tuning.
 * `tuning` carries the `animationId` it is tuning, so the type itself makes an
 * animation-less tuning state unrepresentable.
 *
 * This module knows nothing about the draft store: `SELECT` carries the
 * `draftAnimationId` for the target element (looked up by the caller from
 * `draftState`) so the machine can decide, without reaching into any other
 * state, whether reselecting an element with an existing draft assignment
 * should land on `selected` or skip straight to `tuning`.
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
  | { type: "BACK" }
  | { type: "CLEAR" };

export const initialPanelState: PanelState = { status: "idle" };

/**
 * Pure and total: every (state, event) pair returns a `PanelState`. An event
 * that does not apply to the current state returns `state` unchanged.
 *
 * - `SELECT` always lands on `selected { vmId }`, or `tuning { vmId, animationId }`
 *   when `draftAnimationId` is given (the element already has a draft
 *   assignment) — from any current state, including reselecting the same
 *   element.
 * - `DESELECT` returns to `idle` from any non-idle state.
 * - `CHOOSE_CUSTOM` only applies from `selected` -> `choosing`.
 * - `PICK` only applies from `choosing` -> `tuning`.
 * - `BACK` walks tuning -> choosing -> selected; a no-op elsewhere.
 * - `CLEAR` drops back to `selected { vmId }` from `choosing`/`tuning`/`selected`
 *   (used when the draft assignment for the current element is removed); a
 *   no-op from `idle`.
 */
export function transition(state: PanelState, event: PanelEvent): PanelState {
  switch (event.type) {
    case "SELECT":
      return event.draftAnimationId
        ? { status: "tuning", vmId: event.vmId, animationId: event.draftAnimationId }
        : { status: "selected", vmId: event.vmId };

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
      if (state.status === "choosing") return { status: "selected", vmId: state.vmId };
      return state;

    case "CLEAR":
      return state.status === "idle" ? state : { status: "selected", vmId: state.vmId };

    default:
      return state;
  }
}
