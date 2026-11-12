// "Ready to join" (Phase 5, H1): the candidate says they can start a job now — when, where, the salary they expect,
// their notice period and the kinds of job — and agrees that companies hiring now may see their profile and invite
// them. It lasts 7 days (Admin can change it); one tap on "Still ready" starts the days again. Pause keeps
// everything. Phone and email are never shown to a company until the candidate accepts an invite.
import { useEffect, useState } from 'react';
import { useToast } from '../../components/ui';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';

const TYPES = [['full_time', 'Full-time'], ['internship', 'Internship'], ['part_time', 'Part-time'], ['contract', 'Contract']];
const day = (ms) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const toForm = (s) => ({
  joinDate: s.joinDate || '', cities: (s.cities || []).join(', '), remote: !!s.remote,
  amount: s.salary ? String(s.salary.amount) : '', unit: s.salary?.unit || 'month', noticeDays: String(s.noticeDays || 0),
  jobTypes: s.jobTypes || [], consent: !!s.consent,
});

/** One line for the card and the page: visible until …, paused, needs a tap, or off. */
export function hireLine(s) {
  if (!s?.on) return 'Off: companies hiring now don’t see you.';
  if (s.paused) return 'Paused: companies hiring now don’t see you until you resume.';
  if (s.stale) return 'Not visible any more: tap Still ready to show companies you can join.';
  if (s.due) return `Visible to companies hiring now until ${day(s.expiresAt)}. Tap Still ready to keep it.`;
  return `Visible to companies hiring now until ${day(s.expiresAt)}.`;
}

export default function MeHire() {
  const toast = useToast();
  const [s, setS] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = (x) => { setS(x); setF(toForm(x)); };
  useEffect(() => { http('/api/me/hire').then(load, (e) => setErr(e.message)); }, []);
  const run = async (fn, said) => { setBusy(true); setErr(''); try { const x = await fn(); setS(x); if (said) toast(said); return x; } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = (on) => run(async () => {
    const body = {
      on, consent: f.consent, joinDate: f.joinDate, cities: f.cities.split(',').map((x) => x.trim()).filter(Boolean), remote: f.remote,
      salary: f.amount ? { amount: Number(f.amount), unit: f.unit } : null, noticeDays: Number(f.noticeDays || 0), jobTypes: f.jobTypes,
    };
    const x = await http('/api/me/hire', { method: 'PUT', body });
    setF(toForm(x));
    return x;
  }, on ? 'Saved: you are ready to join' : 'Turned off');
  if (!s) return err ? <p className="error" role="alert">{err}</p> : <p className="muted">Loading…</p>;
  if (!s.siteOn && !s.on) return <><MeHead title="Ready to join" /><p className="card small">Hiring now is switched off for the moment.</p></>;
  const tone = s.available ? 'b-success' : s.on ? 'b-warning' : 'b-neutral';
  return (
    <>
      <MeHead title="Ready to join" sub="Tell companies hiring now that you can start, and they can invite you to an interview." />
      <section className="card stack g12" aria-labelledby="hire-status-h" data-testid="hire-status">
        <div className="row between g8"><strong id="hire-status-h">Status</strong><span className={`badge ${tone}`} data-testid="hire-badge">{s.available ? 'Visible' : s.on ? (s.paused ? 'Paused' : 'Not visible') : 'Off'}</span></div>
        <p className="small" style={{ margin: 0 }} data-testid="hire-line">{hireLine(s)}</p>
        {s.on && (
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            {!s.paused && <button type="button" className="btn btn-ink" disabled={busy} onClick={() => run(() => http('/api/me/hire/confirm', { method: 'POST' }), 'Thanks: visible for another week')} data-testid="hire-still">Still ready</button>}
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(() => http('/api/me/hire/pause', { method: 'POST', body: { paused: !s.paused } }), s.paused ? 'Resumed' : 'Paused')} data-testid="hire-pause">{s.paused ? 'Resume' : 'Pause'}</button>
          </div>
        )}
        <p className="xs muted" style={{ margin: 0 }}>Your phone number and email are never shown to a company until you accept its invite.</p>
      </section>
      <form className="card stack g12" onSubmit={(e) => { e.preventDefault(); save(true); }} aria-label="Ready to join details" data-testid="hire-form">
        <div className="co-grid">
          <div className="field"><label className="label" htmlFor="hj-date">Earliest join date</label><input id="hj-date" type="date" className="input" value={f.joinDate} onChange={set('joinDate')} /></div>
          <div className="field"><label className="label" htmlFor="hj-notice">Notice period (days)</label><input id="hj-notice" className="input" inputMode="numeric" value={f.noticeDays} onChange={(e) => setF({ ...f, noticeDays: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></div>
        </div>
        <div className="field"><label className="label" htmlFor="hj-cities">Cities you can work in (comma between)</label><input id="hj-cities" className="input" placeholder="Hyderabad, Pune" value={f.cities} onChange={set('cities')} /></div>
        <label className="row g8 small"><input type="checkbox" value="remote" checked={f.remote} onChange={set('remote')} /> Remote is fine</label>
        <div className="co-grid">
          <div className="field"><label className="label" htmlFor="hj-sal">Expected salary</label><input id="hj-sal" className="input" inputMode="decimal" placeholder={f.unit === 'lpa' ? '3.5' : '25000'} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '').slice(0, 9) })} /></div>
          <div className="field"><label className="label" htmlFor="hj-unit">Per</label><select id="hj-unit" className="input" value={f.unit} onChange={set('unit')}><option value="month">₹ a month</option><option value="lpa">Lakhs a year (LPA)</option></select></div>
        </div>
        <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Kinds of job</legend>
          <div className="row g12" style={{ flexWrap: 'wrap' }}>
            {TYPES.map(([k, l]) => <label key={k} className="row g4 small"><input type="checkbox" value={k} checked={f.jobTypes.includes(k)} onChange={(e) => setF({ ...f, jobTypes: e.target.checked ? [...f.jobTypes, k] : f.jobTypes.filter((x) => x !== k) })} /> {l}</label>)}
          </div>
        </fieldset>
        <label className="row g8 small" style={{ alignItems: 'flex-start' }}><input type="checkbox" value="consent" checked={f.consent} onChange={set('consent')} style={{ marginTop: 3 }} data-testid="hire-consent" /> <span>Companies hiring now can see my profile and invite me. (Not my phone or email: those only after I accept an invite.)</span></label>
        {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-ink" disabled={busy} data-testid="hire-save">{s.on ? 'Save' : 'Turn on Ready to join'}</button>
          {s.on && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => save(false)} data-testid="hire-off">Turn off</button>}
        </div>
      </form>
      {s.on && (
        <label className="row g8 small card-sm">
          <input type="checkbox" value="emails" checked={s.emails} onChange={(e) => run(() => http('/api/me/hire/emails', { method: 'PUT', body: { on: e.target.checked } }))} data-testid="hire-emails" />
          Email me a day before it ends, with a one-tap Still ready
        </label>
      )}
    </>
  );
}

/** The small card on My dashboard. */
export function HireCard() {
  const [s, setS] = useState(null);
  useEffect(() => { http('/api/me/hire').then(setS, () => {}); }, []);
  if (!s || (!s.siteOn && !s.on)) return null;
  const still = async () => { try { setS(await http('/api/me/hire/confirm', { method: 'POST' })); } catch { /* stays */ } };
  return (
    <section className="card stack g8" style={{ flex: '1 1 300px' }} aria-labelledby="hire-card-h" data-testid="hire-card">
      <strong id="hire-card-h">Ready to join</strong>
      <span className="small" data-testid="hire-card-line">{hireLine(s)}</span>
      <span className="row g8" style={{ flexWrap: 'wrap' }}>
        {s.on && !s.paused && (s.due || s.stale) && <button type="button" className="btn btn-ink" onClick={still} data-testid="hire-card-still">Still ready</button>}
        <a href="/me/hire" className="btn btn-outline">{s.on ? 'Change' : 'I can join now'}</a>
      </span>
    </section>
  );
}
