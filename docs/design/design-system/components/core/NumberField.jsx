import React from 'react';
/** 62×28 mono number field with a faint unit; pairs with Slider. */
export function NumberField({ value, unit, step, active, onChange, style }) {
  return <label style={{ width: 62, height: 'var(--control-h-xs)', border: active ? '1px solid var(--border-focus)' : '1px solid var(--border-control)', boxShadow: active ? 'var(--focus-ring)' : 'none', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', padding: '0 6px', gap: 2, background: 'var(--surface-card)', flex: 'none', ...style }}>
    <input type="number" step={step} value={value} onChange={onChange} style={{ width: '100%', border: 0, outline: 0, textAlign: 'right', font: 'var(--type-mono)', background: 'transparent', padding: 0, color: 'var(--text-body)', MozAppearance: 'textfield' }} />
    {unit && <span style={{ color: 'var(--text-faint)', font: 'var(--type-mono)', fontSize: 11 }}>{unit}</span>}
  </label>;
}
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.NumberField = NumberField; }
