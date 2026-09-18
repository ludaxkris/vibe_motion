import * as React from 'react';
/** Bottom-centre confirmation pill; auto-dismiss after ~2s. */
export interface ToastProps { children: React.ReactNode; absolute?: boolean; }
export function Toast(props: ToastProps): JSX.Element;
