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
import { Chip, Empty, MeCard, StickyBar } from './kit';
import '../../styles/me-work.css';

const TONE = { ok: 'ok', check: 'warn', warning: 'bad' };
const VERDICT_IC = { ok: '✓', check: '!', warning: '⚠' };
const rupees = (n) => (n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`);
const readFile = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = no; r.readAsDataURL(file); });
// what the checker looks at (the rules on the server; see the comment above)
const LOOKS = [['₹', 'A fee or deposit you must pay'], ['⛓', 'A bond or a penalty for leaving early'], ['☐', 'Missing basics: pay, role, place, joining date'], ['≈', 'Pay far from similar jobs on Nm7'], ['✓', 'Whether the company is on Nm7'], ['!', 'Words often used in job scams']];

function Result({ r, onSaved }) {
  const tone = TONE[r.verdict] || 'warn';
  return (
    <section className="stack g12 wk-result" aria-label="Result" data-testid="oc-result">
      <div className={`mcard mcard-${tone} wk-verdict`}>
        <span className={`wk-verdict-ic wk-${tone}`} aria-hidden="true">{VERDICT_IC[r.verdict] || '!'}</span>
        <div className="stack g4" style={{ minWidth: 0, flex: 1 }}>
          <span className="mkicker">Result</span>
          <Chip tone={tone} testid="oc-verdict">{r.verdictText}</Chip>
          <p className="wk-verdict-text" data-testid="oc-explain">{r.explanation}</p>
        </div>
      </div>
      {r.findings.length > 0 && (
        <div className="mgrid">
          {r.findings.map((f) => (
            <div key={f.kind} className={`mcard mcard-tight mcard-${f.level === 'warning' ? 'bad' : 'warn'} wk-finding`} data-testid="oc-finding" data-kind={f.kind}>
              <span className="mrow g8"><Chip tone={f.level === 'warning' ? 'bad' : 'warn'}>{f.level === 'warning' ? 'Warning' : 'Check'}</Chip></span>
              <strong className="wk-finding-title">{f.title}</strong>
              <span className="small">{f.detail}</span>
              {(f.quotes || []).map((q) => <q key={q} className="wk-quote">{q}</q>)}
            </div>
          ))}
        </div>
      )}
      {(r.company || r.pay) && (
        <div className="mgrid">
          {r.company && <div className="mcard mcard-tight"><span className="mkicker">Company</span><span className="small" data-testid="oc-company">On Nm7: {r.company.name} · {r.company.trust === 'verified' ? 'Verified company' : 'Basic (not verified yet)'}{r.company.score != null ? ` · trust score ${r.company.score}` : ''}{r.company.slug && <> · <Link to={`/companies/${r.company.slug}`}>company page</Link></>}</span></div>}
          {r.pay && <div className="mcard mcard-tight"><span className="mkicker">Pay</span><span className="small">Pay in the letter: {rupees(r.pay.monthly)} a month. Similar starting jobs on Nm7: {rupees(r.pay.min)}–{rupees(r.pay.max)} ({r.pay.jobs} jobs).</span></div>}
        </div>
      )}
      <span className="small muted wk-note" data-testid="oc-note">{r.note}</span>
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
    <div className="mgrid-2">
      <div className="mstack">
        <form className="mcard wk-form" onSubmit={go} data-testid="oc-form" aria-label="Check an offer">
          <header className="mcard-h">
            <span className="mcard-ic" aria-hidden="true">⚖</span>
            <span className="mcard-ht"><h2 className="mcard-title">Check an offer letter</h2><span className="mcard-sub">Paste the letter or choose its PDF. We read it once to check it.</span></span>
          </header>
          <label className="field"><span className="label">Paste the offer letter</span><textarea className="input wk-paste" rows={9} maxLength={30000} value={text} onChange={(e) => setText(e.target.value)} disabled={!!file} data-testid="oc-text" placeholder="Paste the full text of the offer letter here" /></label>
          <div className="wk-or" aria-hidden="true"><span>or</span></div>
          <label className="wk-file">
            <span className="wk-file-ic" aria-hidden="true">⇪</span>
            <span className="stack g4" style={{ minWidth: 0 }}><span className="label" style={{ margin: 0 }}>…or choose its PDF (3 MB or less)</span><span className="xs muted">{file ? file.name : 'The file is read on our server, then dropped.'}</span></span>
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="oc-pdf" />
          </label>
          {file && <span className="xs muted">{file.name} · read on our server to check it, then dropped. The file is never stored.</span>}
          <label className="wk-toggle"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} data-testid="oc-save" /><span>Save this check (the text without ID numbers, and the result; never the file)</span></label>
          {save && <label className="field"><span className="label">Name for it (optional)</span><input className="input" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Acme offer" /></label>}
          {err && <p className="error" role="alert">{err}</p>}
          <StickyBar label="Check"><button type="submit" className="btn btn-signal" disabled={busy} data-testid="oc-go">{busy ? 'Checking…' : 'Check this offer'}</button></StickyBar>
        </form>
        {r && <Result r={r} onSaved />}
        {r && <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => onUse(r)} data-testid="oc-to-compare">Add to compare</button>}
      </div>
      <div className="mstack">
        <MeCard title="What we look for" sub="Simple rules, the same for every letter. Free." icon="◎" className="wk-looks">
          <ul className="mlist">
            {LOOKS.map(([ic, t]) => <li key={t} className="wk-look"><span aria-hidden="true">{ic}</span>{t}</li>)}
          </ul>
        </MeCard>
        {mine.length > 0 ? (
          <section className="mcard" aria-label="Saved checks" data-testid="oc-saved">
            <header className="mcard-h"><span className="mcard-ht"><h2 className="mcard-title">Saved checks</h2></span></header>
            <ul className="mlist">
              {mine.map((m) => (
                <li key={m.id} className="mitem">
                  <span className="mitem-main"><span className="mitem-title">{m.label || m.facts.company || 'Offer'}</span><span><Chip tone={TONE[m.verdict] || 'warn'}>{m.verdictText}</Chip></span></span>
                  <span className="mitem-side"><button type="button" className="btn btn-outline btn-sm" onClick={() => onUse(m)}>Compare</button><button type="button" className="btn btn-outline btn-sm" onClick={() => del(m.id)}>Delete</button></span>
                </li>
              ))}
            </ul>
          </section>
        ) : !r && <Empty shape="badge" tint="seeker" compact title="No saved checks yet">Tick “Save this check” to keep a result here and compare it later.</Empty>}
      </div>
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
    <section className="stack g16" aria-label="Compare offers" data-testid="oc-compare">
      <p className="small muted" style={{ margin: 0 }}>Up to 3 offers. The in-hand amount shows only when you type your deductions a month (PF, tax, insurance…); we never guess them.</p>
      <div className={`wk-cols wk-cols-${rows.length}`}>
        {rows.map((r, i) => (
          <div key={i} className={`mcard wk-col ${top === i || topHand === i ? 'wk-col-top' : ''}`} data-testid="oc-col">
            <div className="mspread"><span className="mkicker">Offer {i + 1}</span>{rows.length > 2 && <button type="button" className="btn btn-outline btn-sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}</div>
            <div className="wk-sum" data-testid={`oc-sum-${i}`}>
              <span className="wk-sum-row"><span className="wk-sum-l">CTC</span><span className="wk-sum-v">{ctc[i] ? `${rupees(ctc[i])} a year` : '—'}</span>{top === i && <Chip tone="ok">Highest CTC</Chip>}</span>
              <span className="wk-sum-row"><span className="wk-sum-l">In hand</span><span className="wk-sum-v">{hand[i] != null ? `${rupees(hand[i])} a month` : 'type deductions to see'}</span>{topHand === i && <Chip tone="ok">Most in hand</Chip>}</span>
            </div>
            {field(i, 'name', 'Company', 'Company name')}
            <div className="wk-ctc">
              {field(i, 'ctc', 'CTC', '3.5', { inputMode: 'decimal', 'data-testid': `oc-ctc-${i}` })}
              <select className="input" value={r.unit} onChange={set(i, 'unit')} aria-label="CTC unit"><option value="lpa">LPA</option><option value="year">₹ a year</option><option value="month">₹ a month</option></select>
            </div>
            {field(i, 'deductions', 'Deductions a month (optional)', 'e.g. 2500', { inputMode: 'numeric', 'data-testid': `oc-ded-${i}` })}
            {field(i, 'role', 'Role', 'Data analyst')}
            {field(i, 'location', 'Location', 'Hyderabad')}
            {field(i, 'bond', 'Bond', 'None / 2 years, ₹1.5 lakh')}
            {field(i, 'joining', 'Joining date', '1 Dec')}
            <label className="field"><span className="label">Growth notes (your own)</span><textarea className="input" rows={2} maxLength={400} value={r.growth} onChange={set(i, 'growth')} /></label>
          </div>
        ))}
        {rows.length < 3 && (
          <button type="button" className="wk-add" onClick={() => setRows([...rows, { ...BLANK }])} data-testid="oc-add"><span aria-hidden="true">＋</span>Add a third offer</button>
        )}
      </div>
      <span className="small muted">Money isn't everything: think about the role, learning, the bond and the place too.</span>
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
      <div className="wk-tabs" role="tablist" aria-label="Offer checker">
        {[['check', 'Check an offer', '⚖'], ['compare', 'Compare offers', '⇄']].map(([k, l, ic]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`wk-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)} data-testid={`oc-tab-${k}`}><span aria-hidden="true">{ic}</span>{l}</button>)}
      </div>
      {tab === 'check' ? <Check onUse={use} /> : <Compare rows={rows} setRows={setRows} />}
    </div>
  );
}
