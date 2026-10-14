// Settings without code changes: plans & prices, coupons, delivery/refund rules, fees & tax, templates, messages.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../components/ui';
import { useAdmin } from './AdminContext';
import { PageHead, Tabs, inr } from './AdminUI';
import { TEMPLATE_PRESETS } from '../builder/design';

const Num = ({ id, label, value, onChange, suffix, min = 0, max = 100000, step = 1, placeholder }) => (
  <div className="field"><label htmlFor={id} className="label">{label}</label>
    <div className="row g8" style={{ flexWrap: 'nowrap', alignItems: 'center' }}><input id={id} className="input" type="number" min={min} max={max} step={step} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value === '' ? null : +e.target.value)} style={{ height: 42 }} />{suffix && <span className="small muted">{suffix}</span>}</div></div>
);

function Plans() {
  const { settings, actions } = useAdmin();
  const toast = useToast();
  const [plans, setPlans] = useState(settings.plans);
  const dirty = JSON.stringify(plans) !== JSON.stringify(settings.plans);
  return (
    <div className="stack g12">
      {plans.map((p, i) => (
        <div key={p.id} className="card row g12" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '2 1 200px' }}><label htmlFor={`pn-${p.id}`} className="label">Plan name</label><input id={`pn-${p.id}`} className="input" style={{ height: 42 }} value={p.name} onChange={(e) => setPlans((ps) => ps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></div>
          <div style={{ flex: '1 1 120px' }}><Num id={`pp-${p.id}`} label="Price (₹)" value={p.price} min={1} onChange={(v) => setPlans((ps) => ps.map((x, j) => (j === i ? { ...x, price: v } : x)))} /></div>
          <label className="check small"><input type="checkbox" checked={p.active} onChange={(e) => setPlans((ps) => ps.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} />On sale</label>
        </div>
      ))}
      <div className="row g8"><button type="button" className="btn btn-ink" disabled={!dirty || plans.some((p) => !p.price || !p.name.trim())} onClick={() => { actions.settings({ plans }, 'Updated plans & prices', settings.plans.map((p) => `${p.name} ₹${p.price}${p.active ? '' : ' (off)'}`).join(', '), plans.map((p) => `${p.name} ₹${p.price}${p.active ? '' : ' (off)'}`).join(', ')); toast('Plans saved'); }}>Save plans</button>{dirty && <button type="button" className="btn btn-ghost" onClick={() => setPlans(settings.plans)}>Undo changes</button>}</div>
      <span className="xs faint">Price changes apply to new checkouts only. In this preview they’re saved here; the live app reads them from the server.</span>
    </div>
  );
}

function Coupons() {
  const { settings, actions } = useAdmin();
  const toast = useToast();
  const blank = { code: '', type: '%', value: 10, plans: ['expert'], expires: '', limit: 100, used: 0, active: true };
  const [c, setC] = useState(blank);
  const exists = settings.coupons.some((x) => x.code === c.code.toUpperCase());
  const valid = /^[A-Z0-9]{4,16}$/.test(c.code.toUpperCase()) && c.value > 0 && (c.type === '₹' || c.value <= 90) && c.plans.length && c.expires && !exists;
  const save = (list, what) => actions.settings({ coupons: list }, what);
  return (
    <div className="stack g16">
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="table"><thead><tr><th>Code</th><th>Discount</th><th>Plans</th><th>Expires</th><th>Used</th><th>On</th></tr></thead>
          <tbody>{settings.coupons.map((x) => (
            <tr key={x.code}><td className="mono strong">{x.code}</td><td>{x.type === '%' ? `${x.value}%` : inr(x.value)} off</td><td className="small">{x.plans.map((p) => settings.plans.find((pl) => pl.id === p)?.name).join(', ')}</td><td className="small">{x.expires}</td>
              <td className="small">{x.used}/{x.limit}</td>
              <td><input type="checkbox" aria-label={`${x.code} on`} checked={x.active} onChange={(e) => { save(settings.coupons.map((y) => (y.code === x.code ? { ...y, active: e.target.checked } : y)), `${e.target.checked ? 'Turned on' : 'Turned off'} coupon ${x.code}`); }} /></td></tr>))}</tbody></table>
      </div>
      <form className="card stack g12" onSubmit={(e) => { e.preventDefault(); if (!valid) return; save([{ ...c, code: c.code.toUpperCase() }, ...settings.coupons], `Created coupon ${c.code.toUpperCase()}`); setC(blank); toast('Coupon created'); }}>
        <strong>New coupon</strong>
        <div className="grid-auto g12" style={{ '--min': '160px' }}>
          <div className="field"><label htmlFor="cc" className="label">Code</label><input id="cc" className="input mono" style={{ height: 42 }} value={c.code} onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="FRESHER20" />{exists && <span className="error">That code already exists.</span>}</div>
          <div className="field"><label htmlFor="ct" className="label">Type</label><select id="ct" className="input" style={{ height: 42 }} value={c.type} onChange={(e) => setC({ ...c, type: e.target.value })}><option value="%">% off</option><option value="₹">₹ off</option></select></div>
          <Num id="cv" label={c.type === '%' ? 'Percent (max 90)' : 'Amount (₹)'} value={c.value} min={1} onChange={(v) => setC({ ...c, value: v })} />
          <div className="field"><label htmlFor="ce" className="label">Expires</label><input id="ce" className="input" type="date" style={{ height: 42 }} value={c.expires} onChange={(e) => setC({ ...c, expires: e.target.value })} /></div>
          <Num id="cl" label="Max uses" value={c.limit} min={1} onChange={(v) => setC({ ...c, limit: v })} />
        </div>
        <div className="row g8">{settings.plans.map((p) => <label key={p.id} className="check small"><input type="checkbox" checked={c.plans.includes(p.id)} onChange={(e) => setC({ ...c, plans: e.target.checked ? [...c.plans, p.id] : c.plans.filter((x) => x !== p.id) })} />{p.name}</label>)}</div>
        <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={!valid}>Create coupon</button>
      </form>
    </div>
  );
}

function Rules() {
  const { settings, actions } = useAdmin();
  const toast = useToast();
  const [r, setR] = useState(settings.rules);
  const [pct, setPct] = useState(settings.auditPct);
  return (
    <div className="card stack g16">
      <div className="grid-auto g16" style={{ '--min': '220px' }}>
        <Num id="r1" label="Fastest delivery promise" suffix="hours" value={r.minDeliveryHours} min={1} onChange={(v) => setR({ ...r, minDeliveryHours: v })} />
        <Num id="r2" label="Delivery deadline (late = auto refund)" suffix="hours" value={r.deliveryHours} min={1} onChange={(v) => setR({ ...r, deliveryHours: v })} />
        <Num id="r3" label="Auto-approve after delivery" suffix="days" value={r.autoApproveDays} min={1} onChange={(v) => setR({ ...r, autoApproveDays: v })} />
        <Num id="r4" label="Free re-do must be done within" suffix="hours" value={r.redoHours} min={1} onChange={(v) => setR({ ...r, redoHours: v })} />
        <Num id="r5" label="Decide refund requests within" suffix="hours" value={r.refundReviewHours} min={1} onChange={(v) => setR({ ...r, refundReviewHours: v })} />
        <Num id="r6" label="Delete resume files after" suffix="days" value={r.retentionDays} min={1} onChange={(v) => setR({ ...r, retentionDays: v })} />
        <Num id="r7" label="Quality audit sample" suffix="% of deliveries" value={pct} min={1} max={100} onChange={setPct} />
      </div>
      {r.minDeliveryHours > r.deliveryHours && <span className="error">The fastest promise can’t be longer than the deadline.</span>}
      <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={r.minDeliveryHours > r.deliveryHours || Object.values(r).some((v) => !v)} onClick={() => { actions.settings({ rules: r, auditPct: pct }, 'Updated delivery & refund rules', JSON.stringify(settings.rules), JSON.stringify(r)); toast('Rules saved'); }}>Save rules</button>
    </div>
  );
}

function Fees() {
  const { settings, actions } = useAdmin();
  const toast = useToast();
  const [f, setF] = useState(settings.fees);
  const ex = 999; const fee = ex * (f.platformPct || 0) / 100; const gst = fee * (f.gstPct || 0) / 100; const tx = ex * (f.txPct || 0) / 100; const tds = f.tdsPct == null ? 0 : (ex - fee - gst - tx) * f.tdsPct / 100;
  return (
    <div className="row g16" style={{ alignItems: 'flex-start' }}>
      <div className="card stack g16" style={{ flex: '1 1 320px' }}>
        <Num id="f1" label="Platform fee on expert orders" suffix="%" value={f.platformPct} step={0.5} onChange={(v) => setF({ ...f, platformPct: v })} />
        <Num id="f2" label="GST on the platform fee" suffix="%" value={f.gstPct} step={0.5} onChange={(v) => setF({ ...f, gstPct: v })} />
        <Num id="f3" label="Transaction charges (Razorpay)" suffix="%" value={f.txPct} step={0.1} onChange={(v) => setF({ ...f, txPct: v })} />
        <Num id="f4" label="TDS on expert payouts" suffix="%" value={f.tdsPct} step={0.1} placeholder="Ask your CA" onChange={(v) => setF({ ...f, tdsPct: v })} />
        <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} onClick={() => { actions.settings({ fees: f }, 'Updated fees & tax', JSON.stringify(settings.fees), JSON.stringify(f)); toast('Fees saved'); }}>Save fees</button>
      </div>
      <div className="card stack g8 small" style={{ flex: '1 1 280px' }}>
        <strong>Example · {inr(ex)} expert order</strong>
        <span className="row between"><span>Platform fee</span><span>− {inr(fee)}</span></span>
        <span className="row between"><span>GST on fee</span><span>− {inr(gst)}</span></span>
        <span className="row between"><span>Transaction charges</span><span>− {inr(tx)}</span></span>
        <span className="row between"><span>TDS</span><span>{f.tdsPct == null ? 'not set' : `− ${inr(tds)}`}</span></span>
        <hr className="divider" />
        <span className="row between"><strong>Expert receives</strong><strong>{inr(ex - fee - gst - tx - tds)}</strong></span>
      </div>
    </div>
  );
}

function Templates() {
  const { settings, actions } = useAdmin();
  const off = settings.templatesOff; const rec = settings.templatesRecommended;
  return (
    <div className="card table-wrap" style={{ padding: 0 }}>
      <table className="table"><thead><tr><th>Template</th><th>Shown to users</th><th>“Recommended” badge</th></tr></thead>
        <tbody>{Object.entries(TEMPLATE_PRESETS).map(([k, t]) => (
          <tr key={k}><td><strong>{t.name}</strong><div className="xs faint">{t.desc}</div></td>
            <td><input type="checkbox" aria-label={`Show ${t.name}`} checked={!off.includes(k)} onChange={(e) => actions.settings({ templatesOff: e.target.checked ? off.filter((x) => x !== k) : [...off, k] }, `${e.target.checked ? 'Showing' : 'Hiding'} template ${t.name}`)} /></td>
            <td><input type="checkbox" aria-label={`Recommend ${t.name}`} checked={rec.includes(k)} onChange={(e) => actions.settings({ templatesRecommended: e.target.checked ? [...rec, k] : rec.filter((x) => x !== k) }, `${e.target.checked ? 'Recommended' : 'Un-recommended'} ${t.name}`)} /></td></tr>))}</tbody></table>
    </div>
  );
}

function Messages() {
  const { settings, actions } = useAdmin();
  const toast = useToast();
  const [sel, setSel] = useState(settings.messages[0].id);
  const m = settings.messages.find((x) => x.id === sel);
  const [text, setText] = useState(m.text);
  const sample = { name: 'Sai', plan: 'Expert rewrite', order: 'RS-1051', hours: settings.rules.deliveryHours, link: 'nm7.si/o/RS-1051', days: settings.rules.autoApproveDays, amount: 999 };
  const preview = text.replace(/\{(\w+)\}/g, (_, k) => sample[k] ?? `{${k}}`);
  return (
    <div className="row g16" style={{ alignItems: 'flex-start' }}>
      <div className="card stack g4" style={{ flex: '1 1 220px', padding: 8 }}>{settings.messages.map((x) => <button key={x.id} type="button" onClick={() => { setSel(x.id); setText(x.text); }} className="row between g8" style={{ border: 0, textAlign: 'left', padding: 12, borderRadius: 10, background: sel === x.id ? 'var(--sunken)' : 'transparent' }}><strong className="small">{x.name}</strong><span className="badge b-neutral">{x.channel}</span></button>)}</div>
      <div className="card stack g12" style={{ flex: '2 1 380px' }}>
        <label htmlFor="msg" className="label">{m.name} · {m.channel}</label>
        <textarea id="msg" className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
        <span className="xs faint">Fill-ins: {'{name} {plan} {order} {hours} {link} {days} {amount}'}</span>
        <div className="well small"><strong className="xs muted">Preview</strong><br />{preview}</div>
        <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={text === m.text || !text.trim()} onClick={() => { actions.settings({ messages: settings.messages.map((x) => (x.id === sel ? { ...x, text } : x)) }, `Edited message “${m.name}”`, m.text, text); toast('Message saved'); }}>Save message</button>
      </div>
    </div>
  );
}

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'plans';
  return (
    <>
      <PageHead title="Settings" sub="Change prices, rules and messages without touching code. Every change is in the audit log." />
      <Tabs label="Settings" value={tab} onChange={(v) => setParams(v === 'plans' ? {} : { tab: v })} tabs={[['plans', 'Plans & prices'], ['coupons', 'Coupons'], ['rules', 'Delivery & refund rules'], ['fees', 'Fees & tax'], ['templates', 'Resume templates'], ['messages', 'Messages']]} />
      {tab === 'plans' && <Plans />}{tab === 'coupons' && <Coupons />}{tab === 'rules' && <Rules />}{tab === 'fees' && <Fees />}{tab === 'templates' && <Templates />}{tab === 'messages' && <Messages />}
    </>
  );
}
