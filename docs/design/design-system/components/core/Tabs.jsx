import React from 'react';
/** Folder tabs attached to the panel card: Animate · History · Export. */
export function Tabs({ tabs, value, onChange, disabledAll }) {
  return <div style={{ display: 'flex', gap: 2, padding: '12px 12px 0', fontFamily: 'var(--font-sans)' }}>
    {tabs.map(t => { const on = t === value; const dis = disabledAll && !on; return <span key={t} onClick={() => !dis && onChange && onChange(t)} style={{ flex: 1, textAlign: 'center', padding: '8px 0', fontSize: 12, fontWeight: on ? 600 : 400, color: on ? 'var(--text-tab-active)' : dis ? 'var(--text-disabled)' : 'var(--text-muted)', background: on ? 'var(--surface-card)' : 'transparent', border: on ? '1px solid var(--border-default)' : '1px solid transparent', borderBottomColor: on ? 'var(--surface-card)' : 'transparent', borderRadius: '8px 8px 0 0', marginBottom: -1, cursor: dis ? 'default' : 'pointer', userSelect: 'none' }}>{t}</span>; })}
  </div>;
}
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.Tabs = Tabs; }
