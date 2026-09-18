import * as React from 'react';
/** Folder tabs that attach to the top of a tabbed SectionCard: Animate · History · Export. */
export interface TabsProps { tabs: string[]; value: string; onChange?: (tab: string) => void; disabledAll?: boolean; }
export function Tabs(props: TabsProps): JSX.Element;
