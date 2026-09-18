import React from 'react';
/** Panel card. With tabbed=true the top-left corner is square so a Tabs row can attach. Children are sections separated by dividers. */
export function SectionCard({ children, tabbed, style }) {
  const kids = React.Children.toArray(children);
  return <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-default)', borderRadius: tabbed ? '0 10px 10px 10px' : 'var(--radius-lg)', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-sans)', ...style }}>
    {kids.map((k, i) => <div key={i} style={{ padding: 14, borderBottom: i < kids.length - 1 ? '1px solid var(--border-divider)' : 0, display: 'flex', flexDirection: 'column', gap: 12 }}>{k}</div>)}
  </div>;
}
/** Uppercase 11px section label. */
export function SectionLabel({ children }) { return <span style={{ font: 'var(--type-label)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-label)', color: 'var(--text-muted)' }}>{children}</span>; }
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.SectionCard = SectionCard; window.VM.SectionLabel = SectionLabel; }
