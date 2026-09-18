import * as React from 'react';
/** Button for every action: primary violet, secondary outlined, bar variants for the top bar, danger as a red text link.
 * @startingPoint section="Editor controls" subtitle="Button for every action: primary violet, secondary outlined, bar variants for the top bar, danger as a red text link" viewport="360x160" */
export interface ButtonProps { variant?: "primary" | "secondary" | "ink" | "bar" | "barPrimary" | "danger"; size?: "sm" | "md" | "lg"; disabled?: boolean; glow?: boolean; icon?: React.ReactNode; children?: React.ReactNode; onClick?: () => void; style?: React.CSSProperties; }
export function Button(props: ButtonProps): JSX.Element;
