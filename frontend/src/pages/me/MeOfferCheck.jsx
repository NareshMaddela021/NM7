// Offer checker and compare offers (Phase 6, S5). Check: paste the offer letter or choose its PDF (read on the server
// in memory; the file is never stored, and nothing is kept unless you press Save). The rules look for a fee or
// deposit, a bond or penalty, missing basics, pay far from similar jobs on Nm7, whether the company is on Nm7, and
// scam words; the verdict is "Looks OK", "Check these points" or "Warning". Compare: 2–3 offers side by side; the
// in-hand amount shows only when you type your deductions.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../../services/http';
import { best, inHandMonthly, yearly } from '../../lib/offerCompare';
import { MeHead } from './MeLayout';

const TONE = { ok: 'b-success', check: 'b-signal', warning: 'b-danger' };
const rupees = (n) => (n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`);
const readFile = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = no; r.readAsDataURL(file); });

function Result({ r, onSaved }) {
  return (
    <section className="card stack g8" aria-label="Result" data-testid="oc-result">
      <div className="row between g8" style={{ flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 18 }}>Result</strong>
        <span className={`badge ${TONE[r.verdict]}`} data-testid="oc-verdict">{r.verdictText}</span>
      </div>
      <p className="small" style={{ margin: 0 }} data-testid="oc-explain">{r.explanation}</p>
      {r.findings.map((f) => (
        <div key={f.kind} className="card-sm stack g4" data-testid="oc-finding" data-kind={f.kind}>
          <strong className="small">{f.level === 'warning' ? '⚠ ' : '• '}{f.title}</strong>
          <span className="small">{f.detail}</span>
          {(f.quotes || []).map((q) => <q key={q} className="xs muted" style={{ overflowWrap: 'anywhere' }}>{q}</q>)}
        </div>
      ))}
      {r.company && <span className="small" data-testid="oc-company">On Nm7: {r.company.name} · {r.company.trust === 'verified' ? 'Verified company' : 'Basic (not verified yet)'}{r.company.score != null ? ` · trust score ${r.company.score}` : ''}{r.company.slug && <> · <Link to={`/companies/${r.company.slug}`}>company page</Link></>}</span>}
      {r.pay && <span className="xs muted">Pay in the letter: {rupees(r.pay.monthly)} a month. Similar starting jobs on Nm7: {rupees(r.pay.min)}–{rupees(r.pay.max)} ({r.pay.jobs} jobs).</span>}
      <span className="xs muted" data-testid="oc-note">{r.note}</span>
      {!r.saved && onSaved && <span className="xs muted">Not saved. Nothing from this letter is kept unless you save it.</span>}
    </section>
  );
}

function Check({ onUse }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [label, setLabel] = useState('');
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [r, setR] = useState(null);
  const [mine, setMine] = useState([]);
  const load = () => http('/api/me/offer-check').then(setMine, () => {});
  useEffect(() => { load(); }, []);
  const go = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(''); setR(null);
    try {
      if (file && file.size > 3 * 1024 * 1024) throw new Error('Choose a PDF of 3 MB or less, or paste the text.');
      const body = { text: file ? '' : text, pdf: file ? await readFile(file) : '', save, label: label.trim() };
      const got = await http('/api/me/offer-check', { method: 'POST', body });
      setR(got);
      if (got.saved) load();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const del = async (id) => { try { await http(`/api/me/offer-check/${id}`, { method: 'DELETE' }); load(); } catch (x) { setErr(x.message); } };
  return (
    <div className="stack g12">
      <form className="card stack g8" onSubmit={go} data-testid="oc-form">
        <label className="field"><span className="label">Paste the offer letter</span><textarea className="input" rows={8} maxLength={30000} value={text} onChange={(e) => setText(e.target.value)} disabled={!!file} data-testid="oc-text" /></label>
        <label className="field"><span className="label">…or choose its PDF (3 MB or less)</span><input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="oc-pdf" /></label>
        {file && <span className="xs muted">{file.name} · read on our server to check it, then dropped. The file is never stored.</span>}
        <label className="row g8 small"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} data-testid="oc-save" />Save this check (the text without ID numbers, and the result; never the file)</label>
        {save && <label className="field"><span className="label">Name for it (optional)</span><input className="input" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Acme offer" /></label>}
        {err && <p className="error" role="alert">{err}</p>}
        <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="oc-go">{busy ? 'Checking…' : 'Check this offer'}</button>
      </form>
      {r && <Result r={r} onSaved />}
      {r && <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => onUse(r)} data-testid="oc-to-compare">Add to compare</button>}
      {mine.length > 0 && (
        <section className="stack g8" aria-label="Saved checks" data-testid="oc-saved">
          <strong>Saved checks</strong>
          {mine.map((m) => (
            <div key={m.id} className="row between g8 card-sm" style={{ flexWrap: 'wrap' }}>
              <span className="small">{m.label || m.facts.company || 'Offer'} · <span className={`badge ${TONE[m.verdict]}`}>{m.verdictText}</span></span>
              <span className="row g8"><button type="button" className="btn btn-outline btn-sm" onClick={() => onUse(m)}>Compare</button><button type="button" className="btn btn-outline btn-sm" onClick={() => del(m.id)}>Delete</button></span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

const BLANK = { name: '', ctc: '', unit: 'lpa', deductions: '', location: '', role: '', bond: '', joining: '', growth: '' };

function Compare({ rows, setRows }) {
  const set = (i, k) => (e) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));
  const ctc = rows.map((r) => yearly(r.ctc, r.unit));
  const hand = rows.map((r, i) => inHandMonthly(ctc[i], r.deductions));
  const top = best(ctc);
  const topHand = best(hand);
  const field = (i, k, label, ph, extra = {}) => <label className="field"><span className="label">{label}</span><input className="input" maxLength={200} value={rows[i][k]} onChange={set(i, k)} placeholder={ph} {...extra} /></label>;
  return (
    <section className="stack g12" aria-label="Compare offers" data-testid="oc-compare">
      <span className="small muted">Up to 3 offers. The in-hand amount shows only when you type your deductions a month (PF, tax, insurance…); we never guess them.</span>
      <div className="row g12" style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
        {rows.map((r, i) => (
          <div key={i} className="card stack g8" style={{ flex: '1 1 250px', minWidth: 0 }} data-testid="oc-col">
            {field(i, 'name', 'Company', 'Company name')}
            <div className="row g8" style={{ alignItems: 'flex-end' }}>
              {field(i, 'ctc', 'CTC', '3.5', { inputMode: 'decimal', 'data-testid': `oc-ctc-${i}` })}
              <select className="input" style={{ width: 'auto', height: 40 }} value={r.unit} onChange={set(i, 'unit')} aria-label="CTC unit"><option value="lpa">LPA</option><option value="year">₹ a year</option><option value="month">₹ a month</option></select>
            </div>
            {field(i, 'deductions', 'Deductions a month (optional)', 'e.g. 2500', { inputMode: 'numeric', 'data-testid': `oc-ded-${i}` })}
            {field(i, 'role', 'Role', 'Data analyst')}
            {field(i, 'location', 'Location', 'Hyderabad')}
            {field(i, 'bond', 'Bond', 'None / 2 years, ₹1.5 lakh')}
            {field(i, 'joining', 'Joining date', '1 Dec')}
            <label className="field"><span className="label">Growth notes (your own)</span><textarea className="input" rows={2} maxLength={400} value={r.growth} onChange={set(i, 'growth')} /></label>
            <div className="stack g4 small" data-testid={`oc-sum-${i}`}>
              <span>CTC: {ctc[i] ? `${rupees(ctc[i])} a year` : '—'}{top === i && <span className="badge b-success" style={{ marginLeft: 6 }}>Highest CTC</span>}</span>
              <span>In hand: {hand[i] != null ? `${rupees(hand[i])} a month` : 'type deductions to see'}{topHand === i && <span className="badge b-success" style={{ marginLeft: 6 }}>Most in hand</span>}</span>
            </div>
            {rows.length > 2 && <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        ))}
      </div>
      {rows.length < 3 && <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRows([...rows, { ...BLANK }])} data-testid="oc-add">Add a third offer</button>}
      <span className="xs muted">Money isn't everything: think about the role, learning, the bond and the place too.</span>
    </section>
  );
}

export default function MeOfferCheck() {
  const [tab, setTab] = useState('check');
  const [rows, setRows] = useState([{ ...BLANK }, { ...BLANK }]);
  const use = (r) => {
    const f = r.facts || {};
    const bond = (r.findings || []).find((x) => x.kind === 'bond');
    const row = { ...BLANK, name: f.company || r.label || '', ctc: f.ctc ? String(f.ctc) : '', unit: 'year', role: f.role || '', location: f.city || '', bond: bond ? bond.title.replace(/^There is a bond or penalty ?/, '').replace(/[()]/g, '') || 'Yes' : 'None found' };
    const free = rows.findIndex((x) => !x.name && !x.ctc);
    setRows(free >= 0 ? rows.map((x, i) => (i === free ? row : x)) : rows.length < 3 ? [...rows, row] : rows);
    setTab('compare');
  };
  return (
    <div className="stack g16" data-testid="me-offer-check">
      <MeHead title="Offer checker" sub="Check an offer letter for fees, bonds and missing basics, and compare offers side by side. Free." />
      <div className="row g8" role="tablist" aria-label="Offer checker">
        {[['check', 'Check an offer'], ['compare', 'Compare offers']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn btn-sm ${tab === k ? 'btn-ink' : 'btn-outline'}`} onClick={() => setTab(k)} data-testid={`oc-tab-${k}`}>{l}</button>)}
      </div>
      {tab === 'check' ? <Check onUse={use} /> : <Compare rows={rows} setRows={setRows} />}
    </div>
  );
}
