import * as React from 'react';
/** Mono identifier of a page element (h1, a.cta, .plan:2). */
export interface ElementTagProps { children: React.ReactNode; tone?: "accent" | "muted"; size?: "sm" | "md"; }
export function ElementTag(props: ElementTagProps): JSX.Element;
