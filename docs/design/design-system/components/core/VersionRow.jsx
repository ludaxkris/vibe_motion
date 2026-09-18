import React from 'react';
/** History list row. current = grey background; viewing = violet left rule; children = expanded diff/actions. */
export function VersionRow({ version, label, meta, current, viewing, onClick, children }) {
  return <div onClick={onClick} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border-divider)', borderLeft: viewing ? '3px solid var(--vm-accent)' : '3px solid transparent', background: viewing ? 'var(--vm-accent-tint)' : current ? 'var(--vm-panel)' : 'transparent', cursor: onClick ? 'pointer' : 'default', fontFamily: 'var(--font-sans)' }}>
    <div style={{ display: 'flex', gap: 10 }}><span style={{ font: 'var(--type-mono)', fontWeight: 600, width: 24, flex: 'none', color: viewing ? 'var(--vm-accent)' : current ? 'var(--text-body)' : 'var(--text-muted)' }}>{version}</span><div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}><span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{meta}</span></div></div>
    {children && <div style={{ marginLeft: 34, display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>}
  </div>;
}
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.VersionRow = VersionRow; }
