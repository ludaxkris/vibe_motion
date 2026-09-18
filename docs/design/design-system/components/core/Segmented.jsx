import React from 'react';
/** 2–4 mutually exclusive options (trigger, repeat, export mode). */
export function Segmented({ options, value, onChange, dense }) {
  return <div style={{ display: 'flex', background: 'var(--surface-control)', borderRadius: 'var(--radius-md)', padding: 2, fontFamily: 'var(--font-sans)' }}>
    {options.map(o => { const on = o.value === value; return <span key={o.value} onClick={() => onChange && onChange(o.value)} style={{ flex: 1, textAlign: 'center', padding: dense ? '4px 0' : '6px 0', fontSize: 12, fontWeight: on ? 500 : 400, color: on ? 'var(--text-tab-active)' : 'var(--text-muted)', background: on ? 'var(--surface-card)' : 'transparent', borderRadius: 'var(--radius-sm)', boxShadow: on ? 'var(--shadow-raised)' : 'none', cursor: 'pointer', userSelect: 'none' }}>{o.label}</span>; })}
  </div>;
}
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.Segmented = Segmented; }
