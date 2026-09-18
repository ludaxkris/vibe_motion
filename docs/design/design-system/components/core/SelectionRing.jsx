import React from 'react';
/** Wraps an on-page element. selected → solid ring + tag; hover → dashed ring. inset/radius tune the offset. */
export function SelectionRing({ selected, hover, tag, inset = -6, radius = 12, children, style, ...rest }) {
  return <div style={{ position: 'relative', ...style }} {...rest}>
    {children}
    {selected && <div style={{ position: 'absolute', inset, border: '2px solid var(--selection-ring)', borderRadius: radius, pointerEvents: 'none' }}><span style={{ position: 'absolute', left: -2, top: -22, background: 'var(--selection-ring)', color: '#fff', font: '500 11px var(--font-mono)', padding: '2px 7px', borderRadius: '4px 4px 0 0', whiteSpace: 'nowrap' }}>{tag}</span></div>}
    {hover && !selected && <div style={{ position: 'absolute', inset, border: '1.5px dashed var(--selection-ring)', borderRadius: radius, pointerEvents: 'none', opacity: .8 }} />}
  </div>;
}
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.SelectionRing = SelectionRing; }
