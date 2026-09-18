import * as React from 'react';
/** Mutually exclusive 2–4 options: trigger (load/hover/in view), repeat (1/2/3/∞), export mode. */
export interface SegmentedProps { options: { value: string; label: string }[]; value: string; onChange?: (value: string) => void; dense?: boolean; }
export function Segmented(props: SegmentedProps): JSX.Element;
