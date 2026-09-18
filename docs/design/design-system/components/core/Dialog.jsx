import React from 'react';
/** Centered modal on the violet scrim. Used for the unsaved-changes guard and the Save dialog. */
export function Dialog({ title, meta, children, actions, width = 380, absolute }) {
  return <div style={{ position: absolute ? 'absolute' : 'fixed', inset: 0, background: 'var(--vm-scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
    <div style={{ width, background: 'var(--surface-card)', borderRadius: 'var(--radius-2xl)', padding: 22, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: 'var(--shadow-modal)', fontFamily: 'var(--font-sans)', color: 'var(--text-body)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}><span style={{ font: 'var(--type-title)' }}>{title}</span>{meta && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{meta}</span>}</div>
      {children}
      {actions && <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>{actions}</div>}
    </div>
  </div>;
}
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.Dialog = Dialog; }
