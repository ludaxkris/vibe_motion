import React from 'react';
/** Bottom-centre pill confirmation (“Saved v6”, “Copied CSS”). */
export function Toast({ children, absolute }) {
  return <div style={{ position: absolute ? 'absolute' : 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: 'var(--vm-ink)', color: '#fff', fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500, padding: '8px 14px', borderRadius: 'var(--radius-pill)', boxShadow: 'var(--shadow-popover)', whiteSpace: 'nowrap' }}>{children}</div>;
}
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.Toast = Toast; }
