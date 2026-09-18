import * as React from 'react';
/** Catalog picker card in a 2-column grid; hovering previews on the page, clicking applies. */
export interface AnimationCardProps { name: string; active?: boolean; onMouseEnter?: () => void; onMouseLeave?: () => void; onClick?: () => void; demoStyle?: React.CSSProperties; }
export function AnimationCard(props: AnimationCardProps): JSX.Element;
