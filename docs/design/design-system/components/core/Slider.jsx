import React from 'react';
/** Label · range · NumberField row used for every animation parameter. */
export function Slider({ label, value, min = 0, max = 100, step = 1, unit, active, onChange }) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-sans)' }}>
    <span style={{ width: 56, fontSize: 12, color: 'var(--text-muted)', flex: 'none' }}>{label}</span>
    <div style={{ flex: 1, position: 'relative', height: 'var(--slider-track-h)', background: 'var(--surface-control-track)', borderRadius: 2 }}>
      <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: pct + '%', background: 'var(--vm-accent)', borderRadius: 2 }} />
      <div style={{ position: 'absolute', left: pct + '%', top: -5, width: 'var(--slider-thumb)', height: 'var(--slider-thumb)', marginLeft: -7, borderRadius: '50%', background: '#fff', boxShadow: 'var(--shadow-thumb)' }} />
      <input type="range" min={min} max={max} step={step} value={value} onChange={onChange} style={{ position: 'absolute', inset: '-8px 0', width: '100%', opacity: 0, cursor: 'pointer', margin: 0 }} />
    </div>
    <label style={{ width: 62, height: 'var(--control-h-xs)', border: active ? '1px solid var(--border-focus)' : '1px solid var(--border-control)', boxShadow: active ? 'var(--focus-ring)' : 'none', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', padding: '0 6px', gap: 2, background: 'var(--surface-card)', flex: 'none' }}>
      <input type="number" step={step} value={value} onChange={onChange} style={{ width: '100%', border: 0, outline: 0, textAlign: 'right', font: 'var(--type-mono)', background: 'transparent', padding: 0, color: 'var(--text-body)' }} />
      {unit && <span style={{ color: 'var(--text-faint)', font: 'var(--type-mono)', fontSize: 11 }}>{unit}</span>}
    </label>
  </div>;
}
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.Slider = Slider; }
