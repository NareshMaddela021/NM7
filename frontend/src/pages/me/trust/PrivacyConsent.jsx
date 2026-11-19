// Profile & settings -> Privacy & consent (Vetting Trust T1, DPDP). Only for people who get Vetting Trust (Admin -> Skill
// checks -> Vetting Trust; useTrustOn). Lazy: loaded only once the switch says yes.
//   1. Age gate: the date of birth, once (only the day they turn 18 is kept; never used for scoring).
//   2. Under 18: a parent's email gets a one-time link; until the parent agrees, consents are locked.
//   3. One switch per purpose with its plain-language text; switching one off asks first, then deletes that data now.
//   4. How long we keep each kind of data, and a download of the consent record.
//   A change fires a `trust-consent` window event (T2's DigiLocker card listens to it).
import { useEffect, useState } from 'react';
import { Dialog, useToast } from '../../../components/ui';
import { http } from '../../../services/http';
import { MeCard } from '../kit';
import AgentCard from './AgentCard'; // T5: Calls & WhatsApp, in this chunk (no new lazy chunk)
import WorkPrefsCard from './WorkPrefsCard'; // T6: Work preferences + location pin, in this chunk too
import CriteriaCard from './CriteriaCard'; // T7: job requirements I was checked on, add evidence (this chunk too)
import IntegrityCard from './IntegrityCard'; // T8: my integrity rating, what was noticed, explain (this chunk too)
import SpokenCard from './Spoken'; // T10: my spoken-English band, how it was measured, how to retake (this chunk too)

const fmt = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
import { IcShield } from '../../../components/icons';
const STATUS = { granted: 'On', not_given: 'Off', withdrawn: 'Taken back', outdated: 'Text changed: please read and agree again' };

function download(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function AgeGate({ onDone }) {
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
      <p className="small" style={{ margin: 0 }}>Before you use skill verification, please confirm your date of birth. We keep only whether you are 18 or older (and the day you turn 18), never the date itself, and it is never used to score or rank you.</p>
      <div className="field" style={{ maxWidth: 260 }}>
        <label className="label" htmlFor="tc-dob">Date of birth</label>
        <input id="tc-dob" type="date" className="input" max={today} value={dob} onChange={(e) => setDob(e.target.value)} aria-invalid={err ? 'true' : undefined} aria-describedby={err ? 'tc-dob-err' : undefined} data-testid="tc-dob" />
        {err && <span id="tc-dob-err" className="error" role="alert">{err}</span>}
      </div>
      <div><button type="submit" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy} data-testid="tc-age-save">Confirm</button></div>
    </form>
  );
}

function ParentAsk({ age, onDone }) {
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

export default function PrivacyConsent() {
  return <><ConsentCard /><IntegrityCard /><SpokenCard /><WorkPrefsCard /><CriteriaCard /><AgentCard /></>;
}

function ConsentCard() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [ask, setAsk] = useState(null); // the consent being taken back
  const [busy, setBusy] = useState('');
  const load = () => http('/api/me/trust/privacy').then(setD, (x) => setErr(x.message));
  useEffect(() => { load(); }, []);
  if (err) return <MeCard as="section" id="s-consent" className="acc-sec" label="Privacy and consent" icon={<IcShield />} title="Privacy & consent"><p className="error" role="alert">{err}</p></MeCard>;
  if (!d) return null;
  const locked = !d.age.checked || (d.age.minor && !d.age.parentOk);
  const setAge = (age) => setD({ ...d, age });
  const give = async (c) => {
    setBusy(c.purpose);
    try { await http(`/api/me/trust/consents/${c.purpose}`, { method: 'POST' }); toast(`${c.title}: on`); await load(); window.dispatchEvent(new Event('trust-consent')); } catch (x) { toast(x.message); } finally { setBusy(''); }
  };
  const takeBack = async () => {
    const c = ask; setBusy(c.purpose);
    try { const r = await http(`/api/me/trust/consents/${c.purpose}`, { method: 'DELETE' }); setAsk(null); toast(r.deleted ? `Taken back. ${r.deleted} item${r.deleted === 1 ? '' : 's'} deleted.` : 'Taken back.'); await load(); window.dispatchEvent(new Event('trust-consent')); } catch (x) { toast(x.message); } finally { setBusy(''); }
  };
  const record = async () => {
    try { download(await http('/api/me/trust/consents/export'), 'my-nm7-consents.json'); toast('Your consent record is ready'); } catch (x) { toast(x.message); }
  };
  return (
    <MeCard as="section" id="s-consent" className="acc-sec" label="Privacy and consent" icon={<IcShield />} title="Privacy & consent" sub="Say yes or no to each use of your data on its own. You can take any of them back at any time; we then delete that data." testid="tc-card">
      {!d.age.checked && <AgeGate onDone={setAge} />}
      {d.age.checked && d.age.minor && !d.age.parentOk && <ParentAsk age={d.age} onDone={setAge} />}
      <ul className="mlist" aria-label="Consents">
        {d.consents.map((c) => {
          const on = c.status === 'granted';
          return (
            <li key={c.purpose} className="mitem" data-testid={`tc-${c.purpose}`} style={{ flexWrap: 'wrap' }}>
              <span className="mitem-main" style={{ minWidth: 0, flex: '1 1 260px' }}>
                <span className="mitem-title">{c.title}</span>
                <span className="mitem-meta">{c.text}</span>
                <span className="xs faint" data-testid="tc-state">{STATUS[c.status]}{on && c.grantedAt ? ` · since ${fmt(c.grantedAt)}` : ''}{c.status === 'withdrawn' && c.withdrawnAt ? ` · ${fmt(c.withdrawnAt)}` : ''}</span>
              </span>
              <span className="mitem-side">
                <label className="acc-switch small">
                  <input type="checkbox" checked={on} disabled={locked || busy === c.purpose} onChange={() => (on ? setAsk(c) : give(c))} data-testid="tc-toggle" />
                  <span>{on ? 'On' : 'Off'}<span className="sr-only">: {c.title}</span></span>
                </label>
              </span>
            </li>
          );
        })}
      </ul>
      {locked && d.age.checked && <p className="xs faint" style={{ margin: 0 }}>Locked until a parent or guardian agrees.</p>}
      <div className="stack g8">
        <h3 className="acc-keep-h">How long we keep it</h3>
        <ul className="acc-keep small" data-testid="tc-keep">{d.keep.map((k) => <li key={k.label}><strong>{k.label}:</strong> {k.days} days, then deleted automatically.</li>)}</ul>
        <p className="xs faint" style={{ margin: 0 }}>We never store an Aadhaar number or an Aadhaar image. “Download my data” above gives you everything we hold; this gives your consent history.</p>
        <div><button type="button" className="btn btn-outline" style={{ minHeight: 44 }} onClick={record} data-testid="tc-export">Download my consent record</button></div>
      </div>
      {ask && (
        <Dialog showTitle title={`Take back “${ask.title}”?`} onClose={() => setAsk(null)}>
          <div className="stack g12">
            <p className="small" style={{ margin: 0 }}>We stop using your data for this and delete what we hold for it now. This can’t be undone, but you can agree again later.</p>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ink" style={{ minHeight: 44 }} disabled={!!busy} onClick={takeBack} data-testid="tc-withdraw-confirm">Take back and delete</button>
              <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} onClick={() => setAsk(null)}>Keep it</button>
            </div>
          </div>
        </Dialog>
      )}
    </MeCard>
  );
}
