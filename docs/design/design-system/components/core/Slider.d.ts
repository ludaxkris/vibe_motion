import * as React from 'react';
/** One animation parameter: label · violet-filled track · number field. Stack with 14px gap.
 * @startingPoint section="Editor controls" subtitle="One animation parameter: label · violet-filled track · number field" viewport="360x160" */
export interface SliderProps { label: string; value: number; min?: number; max?: number; step?: number; unit?: string; active?: boolean; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; }
export function Slider(props: SliderProps): JSX.Element;
