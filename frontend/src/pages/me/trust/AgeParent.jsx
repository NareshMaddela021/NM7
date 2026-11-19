// Vetting Trust T1 (DPDP): the age gate (date of birth, once; only the day they turn 18 is kept) and, under 18, the
// parent's or guardian's one-time link. Used by Profile & settings → Privacy & consent and by the student quick start.
import { useState } from 'react';
import { http } from '../../../services/http';

const fmt = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function AgeGate({ onDone, intro }) {
  const [dob, setDob] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const submit = async (e) => {
    e.preventDefault();
    if (!dob) { setErr('Enter your date of birth.'); return; }
    setBusy(true); setErr('');
    try { onDone(await http('/api/me/trust/age', { method: 'POST', body: { dob } })); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form className="stack g8" onSubmit={submit} data-testid="tc-age" noValidate>
      <p className="small" style={{ margin: 0 }}>{intro || 'Before you use skill verification, please confirm your date of birth.'} We keep only whether you are 18 or older (and the day you turn 18), never the date itself, and it is never used to score or rank you.</p>
      <div className="field" style={{ maxWidth: 260 }}>
        <label className="label" htmlFor="tc-dob">Date of birth</label>
        <input id="tc-dob" type="date" className="input" max={today} value={dob} onChange={(e) => setDob(e.target.value)} aria-invalid={err ? 'true' : undefined} aria-describedby={err ? 'tc-dob-err' : undefined} data-testid="tc-dob" />
        {err && <span id="tc-dob-err" className="error" role="alert">{err}</span>}
      </div>
      <div><button type="submit" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy} data-testid="tc-age-save">Confirm</button></div>
    </form>
  );
}

export function ParentAsk({ age, onDone }) {
  const [f, setF] = useState({ email: '', name: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const p = age.parent;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { onDone(await http('/api/me/trust/parent', { method: 'POST', body: f })); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="stack g8" data-testid="tc-parent">
      <p className="small" role="status" style={{ margin: 0 }} data-testid="tc-parent-state">
        {p?.status === 'pending' ? `You are under 18. We sent a link to ${p.sentTo} on ${fmt(p.sentAt)}. Until your parent or guardian agrees, skill verification stays locked.`
          : p?.status === 'declined' ? 'Your parent or guardian did not agree, so skill verification stays locked. You can ask again.'
            : p?.status === 'expired' ? 'The link to your parent expired. Send a new one.'
              : 'You are under 18, so the law asks a parent or guardian to agree first. We send them a one-time link; nothing is shared with them except your first name.'}
      </p>
      <form className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={submit} noValidate>
        <div className="field" style={{ flex: '1 1 220px' }}><label className="label" htmlFor="tc-pe">Parent’s or guardian’s email</label><input id="tc-pe" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="tc-parent-email" /></div>
        <div className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor="tc-pn">Their name (optional)</label><input id="tc-pn" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <button type="submit" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy || !f.email} data-testid="tc-parent-send">{p ? 'Send a new link' : 'Send the link'}</button>
      </form>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
