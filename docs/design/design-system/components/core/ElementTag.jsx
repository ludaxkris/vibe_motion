import React from 'react';
/** Mono element identifier: filled violet when it is the selection, muted grey in lists. */
export function ElementTag({ children, tone = 'accent', size = 'md' }) {
  const s = tone === 'accent' ? { background: 'var(--vm-accent)', color: '#fff' } : { background: 'var(--surface-control)', color: 'var(--text-body)' };
  return <span style={{ font: 'var(--type-mono)', fontSize: size === 'sm' ? 11 : 12, padding: size === 'sm' ? '2px 6px' : '3px 8px', borderRadius: size === 'sm' ? 5 : 'var(--radius-sm)', whiteSpace: 'nowrap', flex: 'none', ...s }}>{children}</span>;
}
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.ElementTag = ElementTag; }
