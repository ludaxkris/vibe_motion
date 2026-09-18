import * as React from 'react';
/** Version chip (v5) or the unsaved indicator; onBar switches to the top-bar colours. */
export interface VersionBadgeProps { version?: string; unsaved?: boolean; onBar?: boolean; }
export function VersionBadge(props: VersionBadgeProps): JSX.Element;
