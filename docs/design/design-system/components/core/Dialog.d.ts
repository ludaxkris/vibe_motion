import * as React from 'react';
/** Centered modal for the unsaved-changes guard (380) and the Save dialog (420).
 * @startingPoint section="Editor controls" subtitle="Centered modal for the unsaved-changes guard (380) and the Save dialog (420)" viewport="360x160" */
export interface DialogProps { title: string; meta?: string; children?: React.ReactNode; actions?: React.ReactNode; width?: number; absolute?: boolean; }
export function Dialog(props: DialogProps): JSX.Element;
