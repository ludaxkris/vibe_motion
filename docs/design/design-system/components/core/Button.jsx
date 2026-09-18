import React from 'react';
/** Primary / secondary / bar / danger-link button. */
export function Button({ variant = 'primary', size = 'md', disabled, glow, icon, children, onClick, style }) {
  const h = { sm: 'var(--control-h-sm)', md: 'var(--control-h-md)', lg: 'var(--control-h-lg)' }[size];
  const base = { height: h, padding: '0 14px', borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: 'var(--font-sans)', fontSize: size === 'sm' ? 12 : 13, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, whiteSpace: 'nowrap', border: '1px solid transparent', background: 'transparent', color: 'var(--text-body)', userSelect: 'none' };
  const v = {
    primary: { background: 'var(--vm-accent)', color: 'var(--text-on-accent)', boxShadow: glow ? 'var(--shadow-accent)' : 'none' },
    secondary: { background: 'var(--surface-card)', borderColor: 'var(--border-control)', fontWeight: 500 },
    ink: { background: 'var(--vm-ink)', color: '#fff' },
    bar: { height: 28, borderRadius: 7, fontSize: 12, fontWeight: 500, color: 'var(--text-on-bar)', borderColor: 'var(--vm-bar-border)', padding: '0 12px' },
    barPrimary: { height: 28, borderRadius: 7, fontSize: 12, background: 'var(--vm-bar-accent)', color: 'var(--text-on-bar)' },
    danger: { color: 'var(--text-danger)', fontWeight: 500, padding: 0, height: 'auto', fontSize: 12 },
  }[variant];
  return <button type="button" disabled={disabled} onClick={onClick} style={{ ...base, ...v, ...style }}>{icon && <span style={{ color: variant === 'secondary' ? 'var(--vm-accent)' : 'inherit' }}>{icon}</span>}{children}</button>;
}
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.Button = Button; }
