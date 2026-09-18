import React from 'react';
/** Generic “nimbus” pricing page — the stand-in for a cloned client page. selected/hover: 'h1' | 'cta' | 'plan2' */
export function ClonedPage({ selected, hover, tag, onSelect, onHover }) {
  const { SelectionRing } = window.VM;
  const ring = (id, inset, radius, child, style) => <SelectionRing selected={selected === id} hover={hover === id} tag={tag || id} inset={inset} radius={radius} style={style} onClick={e => { e.stopPropagation(); onSelect && onSelect(id); }} onMouseEnter={() => onHover && onHover(id)} onMouseLeave={() => onHover && onHover(null)}>{child}</SelectionRing>;
  const plan = (name, price, per, desc, cta, popular) => <div style={{ border: popular ? '1.5px solid #1d1d1f' : '1px solid #e6e6e9', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 14, position: 'relative', background: '#fff', height: '100%', boxSizing: 'border-box' }}>{popular && <div style={{ position: 'absolute', top: -11, left: 24, background: '#1d1d1f', color: '#fff', fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 999 }}>Most popular</div>}<div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div><div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.03em' }}>{price}<span style={{ fontSize: 13, color: '#6e6e73', fontWeight: 400, letterSpacing: 0 }}> {per}</span></div><div style={{ fontSize: 13, color: '#6e6e73', lineHeight: 1.5 }}>{desc}</div>{cta}</div>;
  const btn = (label, dark) => <div style={{ marginTop: 'auto', background: dark ? '#1d1d1f' : '#fff', color: dark ? '#fff' : '#1d1d1f', border: dark ? 0 : '1px solid #d2d2d7', borderRadius: 10, padding: dark ? 10 : 9, textAlign: 'center', fontSize: 13, fontWeight: 500 }}>{label}</div>;
  return <div onClick={() => onSelect && onSelect(null)} style={{ height: '100%', overflow: 'hidden', background: '#fff', fontFamily: 'var(--font-sans)', color: '#1d1d1f', letterSpacing: '-.01em', cursor: 'crosshair' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, padding: '0 48px', borderBottom: '1px solid #ececee' }}><b style={{ fontSize: 16, letterSpacing: '-.02em' }}>nimbus</b><div style={{ display: 'flex', gap: 28, fontSize: 13, color: '#4b4b50' }}><span>Product</span><span>Docs</span><span style={{ color: '#1d1d1f', fontWeight: 500 }}>Pricing</span><span>Company</span></div><div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}><span style={{ color: '#4b4b50' }}>Sign in</span><span style={{ background: '#1d1d1f', color: '#fff', padding: '7px 14px', borderRadius: 999, fontWeight: 500 }}>Get started</span></div></div>
    <div style={{ padding: '64px 48px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
      {ring('h1', '-8px -14px', 6, <h1 style={{ margin: 0, fontSize: 48, lineHeight: 1.05, fontWeight: 700, letterSpacing: '-.03em', textWrap: 'balance' }}>Plans that grow with your team.</h1>, { display: 'inline-block' })}
      <p style={{ margin: 0, fontSize: 17, color: '#6e6e73', maxWidth: 520, lineHeight: 1.45 }}>Start free. Upgrade when you need more seats, more history, and priority support.</p>
      <div style={{ display: 'inline-flex', background: '#f2f2f4', borderRadius: 999, padding: 3, fontSize: 13, marginTop: 6 }}><span style={{ padding: '6px 14px', borderRadius: 999, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.08)', fontWeight: 500 }}>Monthly</span><span style={{ padding: '6px 14px', color: '#6e6e73' }}>Yearly <span style={{ color: '#7c5cff', fontWeight: 500 }}>−20%</span></span></div>
    </div>
    <div style={{ margin: '40px 48px 0', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
      {plan('Free', '$0', '/ month', <>For trying things out.<br />1 project · 7-day history</>, btn('Start free'))}
      {ring('plan2', -6, 20, plan('Pro', '$20', '/ month', <>For individuals shipping often.<br />Unlimited projects · 90-day history</>, ring('cta', -5, 13, btn('Upgrade to Pro', true), { marginTop: 'auto' }), true))}
      {plan('Team', '$30', '/ seat', <>For teams that review together.<br />SSO · Shared libraries · Roles</>, btn('Talk to sales'))}
    </div>
    <div style={{ margin: '44px 48px 0', display: 'flex', justifyContent: 'center', gap: 40, color: '#a1a1a6', fontSize: 13, fontWeight: 600, letterSpacing: '.02em' }}><span>ARCADIA</span><span>Holt&amp;Co</span><span>northwind</span><span>VERTEX</span><span>lumen</span></div>
  </div>;
}
if (typeof window !== 'undefined') { window.VM = window.VM || {}; window.VM.ClonedPage = ClonedPage; }
