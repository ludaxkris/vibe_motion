import * as React from 'react';
/** Text field; size xl with prefix "https://" is the entry URL field, sm with a ⌕ prefix is search. */
export interface InputProps { value?: string; placeholder?: string; prefix?: string; size?: "sm" | "md" | "xl"; state?: "default" | "focus" | "error"; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; style?: React.CSSProperties; }
export function Input(props: InputProps): JSX.Element;
