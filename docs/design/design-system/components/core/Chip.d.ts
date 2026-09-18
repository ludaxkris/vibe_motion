import * as React from 'react';
/** Pill filter chip for catalog categories and the help page. */
export interface ChipProps { selected?: boolean; children?: React.ReactNode; onClick?: () => void; }
export function Chip(props: ChipProps): JSX.Element;
