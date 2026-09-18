import React from 'react';
/** v5 chip, or the unsaved dot + caption. onBar renders the top-bar variant. */
export function VersionBadge({ version, unsaved, onBar }) {
  if (unsaved) return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-sans)', fontSize: 11, color: onBar ? 'var(--vm-bar-ink-muted)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: onBar ? 'var(--vm-bar-dot)' : 'var(--vm-accent)' }} />Unsaved</span>;
  return <span style={{ font: 'var(--type-mono)', fontSize: 11, background: onBar ? 'var(--vm-bar-chip)' : 'var(--surface-control)', color: onBar ? 'var(--text-on-bar)' : 'var(--text-muted)', padding: '2px 6px', borderRadius: 'var(--radius-xs)' }}>{version}</span>;
}
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.VersionBadge = VersionBadge; }
