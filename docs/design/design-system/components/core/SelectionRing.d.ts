import * as React from 'react';
/** Wraps a cloned-page element to draw the selection or hover ring and the mono tag. */
export interface SelectionRingProps { selected?: boolean; hover?: boolean; tag?: string; inset?: number; radius?: number; children?: React.ReactNode; style?: React.CSSProperties; }
export function SelectionRing(props: SelectionRingProps): JSX.Element;
