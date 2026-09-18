import React from 'react';
/** Text / URL / search field. Size xl is the entry URL field. */
export function Input({ value, placeholder, prefix, size = 'md', state, onChange, style }) {
  const h = { sm: 34, md: 38, xl: 'var(--control-h-xl)' }[size];
  const border = state === 'error' ? '1.5px solid var(--vm-danger)' : state === 'focus' ? '1px solid var(--border-focus)' : '1px solid var(--border-control)';
  const shadow = state === 'error' ? '0 0 0 3px rgba(208,52,44,.12)' : state === 'focus' ? 'var(--focus-ring)' : 'none';
  return <label style={{ height: h, border, boxShadow: shadow, borderRadius: size === 'xl' ? 'var(--radius-lg)' : 'var(--radius-md)', background: 'var(--surface-card)', display: 'flex', alignItems: 'center', gap: 8, padding: size === 'xl' ? '0 14px' : '0 10px', fontFamily: 'var(--font-sans)', fontSize: size === 'xl' ? 14 : 13, ...style }}>
    {prefix && <span style={{ color: 'var(--text-faint)' }}>{prefix}</span>}
    <input value={value} placeholder={placeholder} onChange={onChange} style={{ border: 0, outline: 0, flex: 1, minWidth: 0, background: 'transparent', font: 'inherit', color: 'var(--text-body)' }} />
  </label>;
}
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.Input = Input; }
