import React from 'react';
/** / — URL entry with clone preview and recent projects. */
export function Entry() {
  const { Button, Input, ClonedPage } = window.VM;
  const recent = [['nimbus.app/pricing', 'v5 · Pulse on .cta · 2h ago'], ['arcadia.studio', 'v2 · Fade In on hero · yesterday'], ['holtandco.com/work', 'v9 · Restored v7 · Mon'], ['lumen.co', 'v0 · Cloned, no animations · Sep 9']];
  return <div style={{ width: '100%', height: '100%', background: 'var(--surface-canvas)', color: 'var(--text-body)', fontFamily: 'var(--font-sans)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <div style={{ height: 'var(--topbar-h)', flex: 'none', background: 'var(--surface-bar)', color: 'var(--text-on-bar)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}><span style={{ fontWeight: 700, fontSize: 13, letterSpacing: 'var(--tracking-snug)' }}>Vibe Motion</span><span style={{ fontSize: 12, color: 'var(--vm-bar-ink-muted)' }}>Help ↗</span></div>
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 56, padding: '36px 120px 60px', minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
        <div style={{ font: 'var(--type-headline)', letterSpacing: 'var(--tracking-tight)' }}>Animate any page.<br /><span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Paste a URL to clone it.</span></div>
        <div style={{ display: 'flex', gap: 8 }}><Input size="xl" prefix="https://" value="nimbus.app/pricing" style={{ flex: 1 }} /><Button variant="ink" style={{ height: 'var(--control-h-xl)', borderRadius: 'var(--radius-lg)', padding: '0 18px', fontSize: 14 }}>Clone</Button></div>
        <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-2xl)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border-divider)', fontSize: 12 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--vm-success)' }} /><b>Cloned</b><span style={{ color: 'var(--text-muted)' }}>42 elements tagged · 3 stylesheets inlined · 1.2 MB</span><span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>1440 × 2130</span></div>
          <div style={{ height: 300, overflow: 'hidden', position: 'relative', background: '#fafafa' }}><div style={{ width: 960, height: 600, transform: 'scale(.617)', transformOrigin: 'top left', position: 'absolute' }}><ClonedPage /></div></div>
          <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border-divider)', alignItems: 'center' }}><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Scripts removed · links absolutized</span><Button variant="secondary" style={{ marginLeft: 'auto' }}>Try another URL</Button><Button glow>Open in editor →</Button></div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 12, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><b style={{ fontSize: 13 }}>Recent projects</b><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>View all</span></div>
        <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-2xl)', overflow: 'hidden' }}>{recent.map(([n, m], i) => <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: i < recent.length - 1 ? '1px solid var(--border-divider)' : 0 }}><div style={{ width: 56, height: 38, borderRadius: 6, background: 'var(--surface-control)', border: '1px solid var(--border-default)', flex: 'none' }} /><div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}><span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</span><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m}</span></div><span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-link)' }}>Open</span></div>)}</div>
        <span style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.5 }}>Opening a recent project loads its current version. Earlier versions are in History inside the editor.</span>
      </div>
    </div>
  </div>;
}
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.Entry = Entry; }
