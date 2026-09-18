import React from 'react';
/** 44px deep-violet editor bar: wordmark · project · version/unsaved · Help · Cancel · Save. */
export function TopBar({ project = 'nimbus.app/pricing', version = 'v5', unsaved, onCancel, onSave }) {
  const { Button, VersionBadge } = window.VM;
  return <div style={{ height: 'var(--topbar-h)', flex: 'none', background: 'var(--surface-bar)', color: 'var(--text-on-bar)', display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', fontFamily: 'var(--font-sans)' }}>
    <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: 'var(--tracking-snug)' }}>Vibe Motion</span><span style={{ width: 1, height: 16, background: 'var(--vm-bar-border)' }} /><span style={{ fontSize: 13, fontWeight: 500, color: 'var(--vm-bar-ink-muted)' }}>{project}</span><VersionBadge version={version} onBar />{unsaved && <VersionBadge unsaved onBar />}
    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--vm-bar-ink-muted)' }}>Help</span><Button variant="bar" disabled={!unsaved} onClick={onCancel}>Cancel</Button><Button variant="barPrimary" disabled={!unsaved} onClick={onSave}>Save</Button>
  </div>;
}
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.TopBar = TopBar; }
