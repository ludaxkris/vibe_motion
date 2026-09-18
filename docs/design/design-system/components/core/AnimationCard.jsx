import React from 'react';
/** Catalog picker card: mini demo box + name. active = hovered/previewing or currently applied. */
export function AnimationCard({ name, active, onMouseEnter, onMouseLeave, onClick, demoStyle }) {
  return <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onClick={onClick} style={{ border: active ? '1.5px solid var(--vm-accent)' : '1px solid var(--border-default)', boxShadow: active ? 'var(--focus-ring)' : 'none', borderRadius: 'var(--radius-lg)', padding: 8, display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer', background: 'var(--surface-card)', fontFamily: 'var(--font-sans)' }}>
    <div style={{ aspectRatio: '16/10', background: active ? 'var(--vm-accent-tint)' : 'var(--vm-panel)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}><span style={{ width: 30, height: 18, borderRadius: 4, background: 'var(--vm-accent)', display: 'block', ...demoStyle }} /></div>
    <span style={{ fontSize: 12, fontWeight: 500 }}>{name}</span>
  </div>;
}
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.AnimationCard = AnimationCard; }
