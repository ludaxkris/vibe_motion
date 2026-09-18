import React from 'react';
/** Pill filter chip (catalog categories). */
export function Chip({ selected, children, onClick }) {
  return <span onClick={onClick} style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: selected ? 500 : 400, padding: '4px 10px', borderRadius: 'var(--radius-pill)', background: selected ? 'var(--vm-ink)' : 'transparent', color: selected ? '#fff' : '#4b4b50', border: selected ? '1px solid var(--vm-ink)' : '1px solid var(--border-control)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>{children}</span>;
}
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.Chip = Chip; }
