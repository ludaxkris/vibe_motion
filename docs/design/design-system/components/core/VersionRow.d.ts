import * as React from 'react';
/** History list row; viewing rows expand with a diff block and Restore / Export actions. */
export interface VersionRowProps { version: string; label: string; meta?: string; current?: boolean; viewing?: boolean; onClick?: () => void; children?: React.ReactNode; }
export function VersionRow(props: VersionRowProps): JSX.Element;
