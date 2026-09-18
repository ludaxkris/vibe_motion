import * as React from 'react';
/** White panel card; each direct child becomes a 14px-padded section with dividers between.
 * @startingPoint section="Editor controls" subtitle="White panel card; each direct child becomes a 14px-padded section with dividers between" viewport="360x160" */
export interface SectionCardProps { children?: React.ReactNode; tabbed?: boolean; style?: React.CSSProperties; }
export function SectionCard(props: SectionCardProps): JSX.Element;
export function SectionLabel(props: { children?: React.ReactNode }): JSX.Element;
