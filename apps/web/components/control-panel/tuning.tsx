"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ElementTag } from "@/components/ui/element-tag";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
import { SectionLabel } from "@/components/ui/section-label";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import type { Assignment, CatalogEntry, CatalogParam, Trigger } from "@/lib/api-client";
import { easingCurvePath } from "@/lib/easing-curve";

import { PanelCard, PanelSection } from "./panel-card";
import { paramControl, paramLabel } from "./param-control";
import { joinValue, splitValue } from "./param-value";

/** The handoff's words for the three triggers. */
const TRIGGER_LABELS: Readonly<Record<Trigger, string>> = {
  load: "On load",
  hover: "On hover",
  "in-view": "In view",
};

/** The easing preview box: 62x28, with the curve drawn 40x16 inside it. */
const CURVE_WIDTH = 40;
const CURVE_HEIGHT = 16;

function EasingCurve({ value }: { value: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="easing-curve"
      className="flex h-[var(--control-h-xs)] w-[62px] shrink-0 items-center justify-center rounded-sm bg-vm-panel"
    >
      <svg
        width={CURVE_WIDTH}
        height={CURVE_HEIGHT}
        viewBox={`0 0 ${CURVE_WIDTH} ${CURVE_HEIGHT}`}
        // A spring overshoots the box on purpose; let it.
        className="overflow-visible"
      >
        <path
          d={easingCurvePath(value, CURVE_WIDTH, CURVE_HEIGHT)}
          fill="none"
          stroke="var(--vm-accent)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/**
 * Label (56px) · control, the shape every param row takes — the handoff's, and
 * the only one: a param whose values are too long to sit in a segmented row
 * takes the easing-style select instead (`param-control.ts`), which fits this
 * shape, rather than a layout of its own.
 */
function ParamRow({ param, children }: { param: CatalogParam; children: ReactNode }) {
  return (
    <div data-param={param.key} className="flex items-center gap-2.5">
      <span className="w-14 shrink-0 text-sm text-vm-ink-2">{paramLabel(param)}</span>
      {children}
    </div>
  );
}

function ParamControlFor({
  param,
  value,
  onChange,
  onCommit,
}: {
  param: CatalogParam;
  value: string;
  onChange: (value: string) => void;
  /** The drag is over and the value has settled (spec §5: that is when the preview replays). */
  onCommit?: (value: string) => void;
}) {
  // `value` goes in so the option list is guaranteed to contain it: a control
  // that cannot show what it is bound to would render with nothing selected.
  const control = paramControl(param, value);
  const label = paramLabel(param);

  if (control.kind === "slider") {
    const { amount, unit } = splitValue(value);
    const asValue = (next: number) => joinValue(next, unit || splitValue(param.default).unit);
    const commit = (next: number) => onChange(asValue(next));

    return (
      <>
        <Slider
          aria-label={label}
          className="flex-1"
          min={control.min}
          max={control.max}
          step={control.step}
          value={[amount]}
          onValueChange={(next) => {
            const nextAmount = Array.isArray(next) ? (next[0] ?? amount) : next;
            commit(nextAmount);
          }}
          // Pointer up (or the keyboard's equivalent): the value the designer
          // settled on, which is the moment to replay it on the page.
          onValueCommitted={(next) => {
            const settled = Array.isArray(next) ? (next[0] ?? amount) : next;
            onCommit?.(asValue(settled));
          }}
        />
        <NumberField
          // The slider carries the param's own name; this is the same value
          // in a second form, so it says which form it is.
          aria-label={`${label} value`}
          value={amount}
          min={control.min}
          max={control.max}
          step={control.step}
          unit={control.unit}
          onCommit={commit}
        />
      </>
    );
  }

  if (control.kind === "segmented") {
    return (
      <Segmented
        dense
        aria-label={label}
        options={control.options}
        value={value}
        onValueChange={onChange}
        // Only short labels reach a segmented, so the segments share the row
        // evenly and nothing has to be clipped to fit.
        className="min-w-0 flex-1 [&>*]:min-w-0 [&>*]:px-1"
      />
    );
  }

  if (control.kind === "color") {
    return (
      <Input
        size="sm"
        aria-label={label}
        className="flex-1"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  // easing / any select with more options than a segmented row can hold
  return (
    <>
      <Select
        value={value}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next);
        }}
      >
        <SelectTrigger
          aria-label={label}
          icon="▾"
          className="h-[var(--control-h-xs)] min-w-0 flex-1 rounded-sm border-vm-border-strong py-0 font-mono text-sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {control.options.map((option) => (
            <SelectItem key={option} value={option} className="font-mono text-sm">
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {control.kind === "easing" ? <EasingCurve value={value} /> : null}
    </>
  );
}

/**
 * Tuning an element's animation (`docs/design/README.md` "2. Editor",
 * tuning): the element and its animation, the trigger, one row per catalog
 * param, and the way back out.
 *
 * Every row is rendered from the catalog entry — the handoff's Duration,
 * Delay, Distance, Scale, Easing and Repeat rows are what the catalog's own
 * params happen to produce (`param-control.ts`), so a new param needs no code
 * here. Controls write to the draft only; nothing on this panel calls the API.
 *
 * Presentational: the store-connected `ControlPanel` resolves the entry and
 * the assignment and supplies the callbacks.
 */
export function TuningPanel({
  vmId,
  entry,
  assignment,
  onTriggerChange,
  onParamChange,
  onParamCommit,
  onChangeAnimation,
  onRemove,
  onReplay,
}: {
  vmId: string;
  entry: CatalogEntry;
  assignment: Assignment;
  onTriggerChange?: (trigger: Trigger) => void;
  onParamChange?: (key: string, value: string) => void;
  /** A slider was released: the value has settled (spec §5 replays the preview then). */
  onParamCommit?: (key: string, value: string) => void;
  /** The "Change" link: back to the picker. */
  onChangeAnimation?: () => void;
  onRemove?: () => void;
  /** Restart the animation in the preview iframe. Absent until the bridge is mounted. */
  onReplay?: () => void;
}) {
  return (
    <PanelCard data-testid="panel-tuning">
      <PanelSection>
        <div className="flex min-w-0 items-center gap-2">
          <ElementTag>{vmId}</ElementTag>
          <span className="min-w-0 flex-1 truncate text-md font-semibold">{entry.name}</span>
          <Button variant="link" className="text-sm" onClick={onChangeAnimation}>
            Change
          </Button>
        </div>

        <SectionLabel>Trigger</SectionLabel>
        <Segmented
          aria-label="Trigger"
          options={entry.triggers.map((trigger) => ({
            value: trigger,
            label: TRIGGER_LABELS[trigger],
          }))}
          value={assignment.trigger}
          onValueChange={(next) => onTriggerChange?.(next as Trigger)}
        />
      </PanelSection>

      <PanelSection className="gap-3.5">
        {entry.params.map((param) => (
          <ParamRow key={param.key} param={param}>
            <ParamControlFor
              param={param}
              value={assignment.params[param.key] ?? param.default}
              onChange={(value) => onParamChange?.(param.key, value)}
              onCommit={(value) => onParamCommit?.(param.key, value)}
            />
          </ParamRow>
        ))}
      </PanelSection>

      <PanelSection className="flex-row items-center gap-2">
        {/* Inert until the shell hands down a live bridge client — there is no
            preview to replay without one. */}
        <Button
          variant="secondary"
          size="sm"
          glyph="↻"
          glyphTone="ink"
          disabled={!onReplay}
          onClick={onReplay}
        >
          Replay
        </Button>
        <Button variant="danger-link" className="ml-auto" onClick={onRemove}>
          Remove animation
        </Button>
      </PanelSection>
    </PanelCard>
  );
}
