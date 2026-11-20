// Admin -> Skill checks -> Vetting Trust (T1, the DPDP pack; owner only, the "settings" permission). Four cards:
//   Switch       the one Vetting Trust switch (site settings `trust`): OFF = only admins, demo accounts and testers see
//                anything new, and background jobs email nobody else. Every Trust item (T1–T15) sits behind it.
//   Retention    how long each kind of personal data is kept (editable within safe bounds), the last automatic
//                deletion counts, and "Run now".
//   Inactivity   erase Trust data after N months without signing in: OFF by itself; warning email first, erase only
//                after the notice period.
//   DigiLocker   (T2) the document provider, keys set / not set, the callback URL, counts and the review queue
//                (TrustDocsAdmin.jsx); ID + selfie (T3, TrustFaceAdmin.jsx); Employer checks and Fraud reports (T4,
//                TrustEmployerAdmin.jsx); Calls & WhatsApp (T5, TrustAgentAdmin.jsx); Integrity rating (T8,
//                TrustIntegrityAdmin.jsx: review queue, evidence view, webcam snapshots).
//   Breach log   72-hour incidents: detected at, data, people, status, the CERT-In 6 h and Board 72 h countdowns,
//                notifications sent (docs/trust/breach-runbook.md).
// All from /api/admin/trust/* (every change audited).
import { Suspense, lazy, useEffect, useState } from 'react';
import { Dialog, useToast } from '../../../components/ui';
import { lazyRetry } from '../../../lib/chunks';
import { Loading, http, useAction, useApi, when } from './common';
import TrustDocsAdmin from './TrustDocsAdmin';
import TrustCriteriaAdmin from './TrustCriteriaAdmin'; // T7: evidence candidates added for job requirements
import TrustFaceAdmin from './TrustFaceAdmin';
import TrustIntegrityAdmin from './TrustIntegrityAdmin'; // T8: integrity rating, review queue, evidence, snapshots
import TrustHonestyAdmin from './TrustHonestyAdmin'; // T9: honesty pledge, retake limits, Explain your answer
import TrustSpokenAdmin from './TrustSpokenAdmin'; // T10: spoken-English score: provider, role categories, counts
import TrustEmployerAdmin from './TrustEmployerAdmin';
import TrustAgentAdmin from './TrustAgentAdmin';
import TrustBookingAdmin from './TrustBookingAdmin'; // T11: interview booking & joining day
import TrustFairnessAdmin from './TrustFairnessAdmin'; // T12: blind grading, re-grades, pass-rate gaps, unfair filters

const TrustCodeAdmin = lazy(lazyRetry(() => import('./TrustCodeAdmin'))); // T14: coding tasks: sandbox, limits, problems, replays
const TrustWorkAdmin = lazy(lazyRetry(() => import('./TrustWorkAdmin'))); // T15: work tests, reliability record disputes

const STATUS = [['open', 'Open'], ['contained', 'Contained'], ['notified', 'Notified'], ['closed', 'Closed']];
const TO = [['certin', 'CERT-In'], ['dpb', 'Data Protection Board'], ['people', 'Affected people'], ['police', 'Police / cyber cell'], ['vendor', 'Vendor / processor'], ['other', 'Other']];
const left = (s) => {
  const a = Math.abs(s); const h = Math.floor(a / 3600); const m = Math.floor((a % 3600) / 60);
  return `${h} h ${m} min ${s < 0 ? 'overdue' : 'left'}`;
};

function Switch({ d, reload }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [testers, setTesters] = useState('');
  useEffect(() => { setTesters((d.testers || []).join('\n')); }, [d.testers]);
  const list = () => testers.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const save = (pub) => run(async () => { await http('/api/admin/trust/switch', { method: 'PUT', body: { public: pub, testers: list() } }); reload(); },
    pub === d.public ? 'Testers saved' : pub ? 'Vetting Trust is now live for everyone' : 'Hidden again: only admins, demo accounts and testers');
  return (
    <section className="card stack g12" aria-labelledby="tt-sw-h" data-testid="tt-switch">
      <div className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
        <h2 id="tt-sw-h" className="h3" style={{ margin: 0 }}>Vetting Trust switch</h2>
        <span className={`mchip ${d.public ? 'mchip-ok' : 'mchip-warn'}`} role="status" data-testid="tt-state">{d.public ? 'Live for everyone' : 'Hidden: admins, demo accounts and testers only'}</span>
      </div>
      <p className="small" style={{ margin: 0 }}>{d.public ? 'Everyone gets Privacy & consent, the age check and every Trust feature built on them.' : 'Everyone else sees the site exactly as before and gets no new emails.'}</p>
      <label className="field stack g4">
        <span className="label">Testers (real accounts that see it while hidden; one email per line)</span>
        <textarea className="input" rows={3} value={testers} onChange={(e) => setTesters(e.target.value)} data-testid="tt-testers" style={{ minHeight: 88 }} />
      </label>
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={() => save(d.public)} data-testid="tt-save-testers">Save testers</button>
        <button type="button" className={`btn ${d.public ? 'btn-outline' : 'btn-signal'}`} style={{ minHeight: 44 }} disabled={busy} onClick={() => save(!d.public)} data-testid="tt-toggle">{d.public ? 'Hide again' : 'Go live for everyone'}</button>
      </div>
    </section>
  );
}

function Retention({ d, reload }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [days, setDays] = useState({});
  useEffect(() => { setDays(Object.fromEntries(d.retention.map((r) => [r.key, String(r.days)]))); }, [d.retention]);
  const changed = d.retention.filter((r) => Number(days[r.key]) !== r.days);
  const save = () => run(async () => { await http('/api/admin/trust/retention', { method: 'PUT', body: { days: Object.fromEntries(changed.map((r) => [r.key, Number(days[r.key])])) } }); reload(); }, 'Retention saved');
  const now = () => run(async () => { const r = await http('/api/admin/trust/retention/run', { method: 'POST' }); reload(); return r; }, 'Deletion job ran');
  return (
    <section className="card stack g12" aria-labelledby="tt-rt-h" data-testid="tt-retention">
      <h2 id="tt-rt-h" className="h3" style={{ margin: 0 }}>Retention schedule</h2>
      <p className="small" style={{ margin: 0 }}>Each kind of data is deleted automatically when its time is over (once a day, in small batches). Days can only be set within the safe range. Last run: {when(d.retentionAt)}.</p>
      <div className="table-wrap mtable-wrap vt-scroll">
        <table className="table mtable vt-table">
          <thead><tr><th>Data</th><th>Keep (days)</th><th>Last deleted</th><th>Deleted in all</th><th>How</th></tr></thead>
          <tbody>
            {d.retention.map((r) => (
              <tr key={r.key} data-testid={`tt-rt-${r.key}`}>
                <th scope="row" className="small">{r.label}{r.purpose ? <span className="xs faint"> · consent: {r.purpose}</span> : null}</th>
                <td data-label="Keep (days)">
                  <input type="number" className="input" style={{ width: 96, minHeight: 44 }} min={r.minDays} max={r.maxDays} value={days[r.key] ?? ''} aria-label={`${r.label}: days (${r.minDays}–${r.maxDays})`}
                    onChange={(e) => setDays({ ...days, [r.key]: e.target.value })} data-testid="tt-rt-days" />
                  <span className="xs faint"> {r.minDays}–{r.maxDays}</span>
                </td>
                <td data-label="Last deleted" data-testid="tt-rt-last">{r.lastDeleted ?? '—'}{r.lastAt ? <span className="xs faint"> · {when(r.lastAt)}</span> : null}</td>
                <td data-label="Deleted in all">{r.totalDeleted}</td>
                <td data-label="How" className="xs">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy || !changed.length} onClick={save} data-testid="tt-rt-save">Save days</button>
        <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={now} data-testid="tt-rt-run">Run the deletion job now</button>
      </div>
    </section>
  );
}

function Inactivity({ d, reload }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(d.inactivity);
  useEffect(() => { setF(d.inactivity); }, [d.inactivity]);
  const save = (on) => run(async () => { await http('/api/admin/trust/inactivity', { method: 'PUT', body: { on, months: Number(f.months), noticeDays: Number(f.noticeDays), mode: f.mode } }); reload(); },
    on === d.inactivity.on ? 'Saved' : on ? 'Erase after inactivity is on' : 'Erase after inactivity is off');
  const last = d.inactivityLast || {};
  return (
    <section className="card stack g12" aria-labelledby="tt-in-h" data-testid="tt-inactivity">
      <div className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
        <h2 id="tt-in-h" className="h3" style={{ margin: 0 }}>Erase after inactivity</h2>
        <span className={`mchip ${d.inactivity.on ? 'mchip-ok' : 'mchip-neutral'}`} role="status" data-testid="tt-in-state">{d.inactivity.on ? `On since ${when(d.inactivity.enabledAt)}` : 'Off'}</span>
      </div>
      <p className="small" style={{ margin: 0 }}>People who haven’t used Nm7 for this long get a warning email first; if they still don’t sign in during the notice period, their Trust data is erased. Nobody is warned for time before this was turned on. While Vetting Trust is hidden only testers can be warned.</p>
      <div className="row g12" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ width: 160 }}><label className="label" htmlFor="tt-in-m">Inactive for (months)</label><input id="tt-in-m" type="number" min={6} max={60} className="input" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} /></div>
        <div className="field" style={{ width: 160 }}><label className="label" htmlFor="tt-in-n">Notice (days)</label><input id="tt-in-n" type="number" min={14} max={90} className="input" value={f.noticeDays} onChange={(e) => setF({ ...f, noticeDays: e.target.value })} /></div>
        <div className="field" style={{ flex: '1 1 220px' }}><label className="label" htmlFor="tt-in-mode">What is erased</label>
          <select id="tt-in-mode" className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="trust">Trust data only (consents, selfies, voice, documents, interviews)</option><option value="account">The whole account (the normal delete-account path)</option></select></div>
      </div>
      <p className="xs faint" style={{ margin: 0 }} data-testid="tt-in-last">Last run: {when(last.at)}{last.at ? ` · warned ${last.warned || 0}, erased ${last.erased || 0}, back again ${last.cleared || 0}` : ''}</p>
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={() => save(d.inactivity.on)}>Save</button>
        <button type="button" className={`btn ${d.inactivity.on ? 'btn-outline' : 'btn-signal'}`} style={{ minHeight: 44 }} disabled={busy} onClick={() => save(!d.inactivity.on)} data-testid="tt-in-toggle">{d.inactivity.on ? 'Turn off' : 'Turn on'}</button>
      </div>
    </section>
  );
}

function NewBreach({ onClose, onDone }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [f, setF] = useState({ title: '', detected: local, dataTypes: '', people: '0', summary: '' });
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await http('/api/admin/trust/breaches', { method: 'POST', body: { title: f.title, detectedAt: new Date(f.detected).getTime(), dataTypes: f.dataTypes.split(',').map((x) => x.trim()).filter(Boolean), people: Number(f.people) || 0, summary: f.summary } });
      onDone();
    }, 'Incident logged: the 72-hour clock is running');
  };
  return (
    <Dialog showTitle title="Log a breach" onClose={onClose}>
      <form className="stack g12" onSubmit={submit}>
        <div className="field"><label className="label" htmlFor="tb-t">What happened (short)</label><input id="tb-t" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="tb-title" /></div>
        <div className="field"><label className="label" htmlFor="tb-d">Detected at</label><input id="tb-d" type="datetime-local" className="input" value={f.detected} onChange={(e) => setF({ ...f, detected: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="tb-dt">What data (comma between)</label><input id="tb-dt" className="input" placeholder="selfies, phone numbers" value={f.dataTypes} onChange={(e) => setF({ ...f, dataTypes: e.target.value })} data-testid="tb-data" /></div>
        <div className="field"><label className="label" htmlFor="tb-p">How many people (best guess)</label><input id="tb-p" type="number" min={0} className="input" value={f.people} onChange={(e) => setF({ ...f, people: e.target.value })} data-testid="tb-people" /></div>
        <div className="field"><label className="label" htmlFor="tb-s">Notes</label><textarea id="tb-s" className="input" rows={3} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></div>
        <button type="submit" className="btn btn-signal" style={{ minHeight: 44, alignSelf: 'flex-start' }} disabled={busy || f.title.trim().length < 3} data-testid="tb-save">Log it</button>
      </form>
    </Dialog>
  );
}

function Breach({ b, reload }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [to, setTo] = useState('certin');
  const [note, setNote] = useState('');
  const setStatus = (status) => run(async () => { await http(`/api/admin/trust/breaches/${b.id}`, { method: 'PUT', body: { status } }); reload(); }, 'Status saved');
  const notify = () => run(async () => { await http(`/api/admin/trust/breaches/${b.id}/notifications`, { method: 'POST', body: { to, note } }); setNote(''); reload(); }, 'Notification recorded');
  const closed = b.status === 'closed';
  return (
    <li className="card stack g8" data-testid="tb-item">
      <div className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
        <strong style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{b.title}</strong>
        {!closed && <span className={`mchip ${b.overdue ? 'mchip-bad' : 'mchip-warn'}`} data-testid="tb-countdown">Board report: {left(b.secondsLeft)}</span>}
      </div>
      <span className="small">Detected {when(b.detectedAt)} · {b.people} people · {b.dataTypes.join(', ') || 'data not listed yet'}</span>
      {b.certinOverdue && !closed && <span className="small" style={{ color: 'var(--danger)' }} role="alert">CERT-In was due within 6 hours ({when(b.certinDueAt)}) and isn’t recorded as told.</span>}
      {b.summary && <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{b.summary}</p>}
      {b.notifications.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{b.notifications.map((n) => <li key={`${n.to}${n.at}`}>{n.label}: {when(n.at)}{n.note ? ` · ${n.note}` : ''}</li>)}</ul>}
      <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ width: 160 }}><label className="label" htmlFor={`tb-st-${b.id}`}>Status</label>
          <select id={`tb-st-${b.id}`} className="input" value={b.status} disabled={busy} onChange={(e) => setStatus(e.target.value)} data-testid="tb-status">{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="field" style={{ flex: '1 1 180px' }}><label className="label" htmlFor={`tb-to-${b.id}`}>Told</label>
          <select id={`tb-to-${b.id}`} className="input" value={to} onChange={(e) => setTo(e.target.value)} data-testid="tb-to">{TO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="field" style={{ flex: '2 1 200px' }}><label className="label" htmlFor={`tb-n-${b.id}`}>Note (reference number, how)</label><input id={`tb-n-${b.id}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={notify} data-testid="tb-notify">Record</button>
      </div>
    </li>
  );
}

function Breaches() {
  const st = useApi('/api/admin/trust/breaches');
  const [open, setOpen] = useState(false);
  return (
    <section className="card stack g12" aria-labelledby="tt-br-h" data-testid="tt-breaches">
      <div className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
        <h2 id="tt-br-h" className="h3" style={{ margin: 0 }}>Breach log</h2>
        <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} onClick={() => setOpen(true)} data-testid="tb-new">Log a breach</button>
      </div>
      <p className="small" style={{ margin: 0 }}>Tell CERT-In within 6 hours of noticing, the Data Protection Board within 72 hours, and affected people without delay. The steps are in the breach runbook (docs/trust/breach-runbook.md).</p>
      <Loading st={st}>{(d) => (d.items.length ? <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{d.items.map((b) => <Breach key={b.id} b={b} reload={st.reload} />)}</ul> : <p className="small muted" style={{ margin: 0 }}>No incidents logged.</p>)}</Loading>
      {open && <NewBreach onClose={() => setOpen(false)} onDone={() => { setOpen(false); st.reload(); }} />}
    </section>
  );
}

export default function TrustAdmin() {
  const st = useApi('/api/admin/trust');
  return (
    <div className="stack g16 tt-page" data-testid="tt-page">
      <Loading st={st}>{(d) => (
        <>
          <Switch d={d} reload={st.reload} />
          <Retention d={d} reload={st.reload} />
          <Inactivity d={d} reload={st.reload} />
        </>
      )}</Loading>
      {!st.error && <TrustDocsAdmin />}
      {!st.error && <TrustCriteriaAdmin />}
      {!st.error && <TrustFaceAdmin />}
      {!st.error && <TrustIntegrityAdmin />}
      {!st.error && <TrustHonestyAdmin />}
      {!st.error && <TrustSpokenAdmin />}
      {!st.error && <Suspense fallback={null}><TrustCodeAdmin /></Suspense>}
      {!st.error && <Suspense fallback={null}><TrustWorkAdmin /></Suspense>}
      {!st.error && <TrustEmployerAdmin />}
      {!st.error && <TrustAgentAdmin />}
      {!st.error && <TrustBookingAdmin />}
      {!st.error && <TrustFairnessAdmin />}
      {!st.error && <Breaches />}
    </div>
  );
}
