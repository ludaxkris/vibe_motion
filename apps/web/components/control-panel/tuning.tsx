"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import type { CatalogParam, Trigger } from "@/lib/api-client";
import { getCatalogEntry } from "@/lib/catalog";
import { useEditorStore } from "@/lib/store";

import { joinValue, splitValue } from "./param-value";

/** Param types that render as a slider + numeric value. */
const SLIDER_TYPES: ReadonlySet<CatalogParam["type"]> = new Set([
  "duration",
  "length",
  "number",
  "angle",
  "percentage",
]);

// The catalog does not always declare `options` for these types (schema.json:
// "options" is required only to be meaningful for `select`, and "the
// suggested list" for `easing`) — fall back to a standard CSS list, always
// including the param's own default so it stays selectable.
const ITERATION_OPTIONS = ["1", "2", "3", "4", "5", "infinite"];
const EASING_OPTIONS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"];
const DIRECTION_OPTIONS = ["normal", "reverse", "alternate", "alternate-reverse"];

function selectOptions(param: CatalogParam): string[] {
  if (param.options?.length) return param.options;
  const fallback =
    param.type === "iteration"
      ? ITERATION_OPTIONS
      : param.type === "direction"
        ? DIRECTION_OPTIONS
        : param.type === "easing"
          ? EASING_OPTIONS
          : [];
  return fallback.includes(param.default) ? fallback : [...fallback, param.default];
}

/**
 * One control per catalog param, rendered from `param.type`: duration / length
 * / number / angle / percentage as a slider + numeric value; easing /
 * direction / select / iteration as a select; color as a text input (catalog
 * color defaults are `rgba(...)` / `currentColor`, not hex, so a native
 * `<input type="color">` cannot round-trip them). Every control writes to the
 * draft only.
 */
export function TuningPanel({ vmId, animationId }: { vmId: string; animationId: string }) {
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);
  const updateDraftParam = useEditorStore((state) => state.updateDraftParam);
  const setDraftAssignment = useEditorStore((state) => state.setDraftAssignment);
  const removeDraftAssignment = useEditorStore((state) => state.removeDraftAssignment);
  const assignment = useEditorStore((state) => state.draftState[vmId]);

  const entry = getCatalogEntry(animationId);

  if (!entry || !assignment) {
    // Defensive: the machine only reaches `tuning` via PICK, which always
    // creates the draft assignment first, so this should not happen in
    // practice — but the panel must still render something sensible if the
    // draft and the panel state ever disagree.
    return (
      <p className="text-sm text-muted-foreground" data-testid="panel-tuning-empty">
        This animation is no longer available.
      </p>
    );
  }

  const handleRemove = () => {
    removeDraftAssignment(vmId);
    dispatchPanel({ type: "CLEAR" });
  };

  const handleTriggerChange = (trigger: string | null) => {
    if (!trigger) return;
    setDraftAssignment(vmId, { ...assignment, trigger: trigger as Trigger });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="panel-tuning">
      <p className="text-sm">
        Tuning <span className="font-medium">{entry.name}</span> on{" "}
        <span className="font-mono text-xs">{vmId}</span>
      </p>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground" htmlFor="trigger-select">
          Trigger
        </label>
        <Select value={assignment.trigger} onValueChange={handleTriggerChange}>
          <SelectTrigger id="trigger-select" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {entry.triggers.map((trigger) => (
              <SelectItem key={trigger} value={trigger}>
                {trigger}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {entry.params.map((param) => {
        const value = assignment.params[param.key] ?? param.default;
        const label = param.label ?? param.key;
        const controlId = `param-${param.key}`;

        if (SLIDER_TYPES.has(param.type)) {
          const { amount, unit } = splitValue(value);
          const min = param.min ? splitValue(param.min).amount : 0;
          const max = param.max ? splitValue(param.max).amount : 100;
          const step = param.step ? splitValue(param.step).amount : 1;

          return (
            <div key={param.key} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <label htmlFor={controlId}>{label}</label>
                <span>{value}</span>
              </div>
              <Slider
                id={controlId}
                aria-label={label}
                min={min}
                max={max}
                step={step}
                value={[amount]}
                onValueChange={(next) => {
                  const nextAmount = Array.isArray(next) ? (next[0] ?? amount) : next;
                  updateDraftParam(vmId, param.key, joinValue(nextAmount, unit));
                }}
              />
            </div>
          );
        }

        if (param.type === "color") {
          return (
            <div key={param.key} className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground" htmlFor={controlId}>
                {label}
              </label>
              <Input
                id={controlId}
                type="text"
                value={value}
                onChange={(event) => updateDraftParam(vmId, param.key, event.target.value)}
              />
            </div>
          );
        }

        // easing / direction / select / iteration
        const options = selectOptions(param);
        return (
          <div key={param.key} className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground" htmlFor={controlId}>
              {label}
            </label>
            <Select
              value={value}
              onValueChange={(next) => {
                if (next !== null) updateDraftParam(vmId, param.key, next);
              }}
            >
              <SelectTrigger id={controlId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={() => dispatchPanel({ type: "BACK" })}>
          Back
        </Button>
        <Button variant="destructive" size="sm" onClick={handleRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}
