import * as React from 'react';
/** 62×28 mono number field with faint unit; the editable half of a Slider row. */
export interface NumberFieldProps { value: number; unit?: string; step?: number; active?: boolean; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; style?: React.CSSProperties; }
export function NumberField(props: NumberFieldProps): JSX.Element;
