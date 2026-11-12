// Admin → Auto Apply (Phase 3, A7): applications per day (Auto vs Manual, by channel), emails sent / bounced /
// complaints, students on / paused, stuck items, company "Not relevant" marks, the run log with errors; the off switch
// (off = nothing is applied or sent), every default, pause a student or a company, and the demo shortcut. All on the
// page, no pop-up dialogs; everything is in the activity log.
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { Kpi, PageHead, Panel } from '../AdminUI';
import { langsShown, useLang } from '../../../lib/i18n';
import { Loading, http, useAction, useApi, when } from './common';

const FIELDS = [
  ['minScore', 'New students’ minimum match score', 50, 100], ['dailyLimit', 'New students’ applications a day', 1, 50],
  ['maxDailyLimit', 'Most applications a day a student may choose', 1, 50], ['previewDays', 'Preview days (each waits for Approve)', 0, 30],
  ['companyCap', 'Applications to one company per 30 days', 1, 20], ['trustMin', 'Skip companies with a trust score under', 0, 100],
  ['borderline', 'Borderline band: points under the minimum that ask the student', 0, 30], ['atsMin', 'ATS score needed to start', 0, 100],
  ['emailDailyCap', 'Auto Apply emails a day, whole site (Resend free plan: 100)', 0, 10000], ['irrelevantStop', 'Company “Not relevant” marks before a student stops going there', 1, 20],
];
const channels = (o) => Object.entries(o || {}).map(([k, v]) => `${k === 'nm7' ? 'Nm7' : k === 'email' ? 'Email' : k === 'link' ? 'Website' : k} ${v}`).join(' · ');
const total = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
// one number per cell, right-aligned, with the channels in small text under it: no "— Nm7 1" (fix round item 36)
const NUM = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const Count = ({ o }) => <td style={NUM}><strong>{total(o)}</strong>{total(o) > 0 && <div className="xs muted">{channels(o)}</div>}</td>;

export function LiveAutoApply() {
  const toast = useToast();
  useLang(); // redraws when Admin → Settings "Show Telugu and Hindi" changes
  const raviLang = langsShown() ? 'Telugu' : 'English'; // Ravi follows that setting (re-test N5)
  const st = useApi('/api/admin/auto-apply');
  const [busy, run] = useAction(toast);
  const [off, setOff] = useState(false);
  const save = (s, msg) => run(async () => { await http('/api/admin/auto-apply/settings', { method: 'PUT', body: s }); st.reload(); setOff(false); }, msg);
  const demo = (url = '/api/admin/auto-apply/demo') => run(async () => { const r = await http(url, { method: 'POST' }); window.location.assign(r.path); });
  return (
    <>
      <PageHead title="Auto Apply" sub="Every morning Nm7 applies for students within their own rules. Nothing is ever submitted on other websites by a bot." />
      <Loading st={st}>{(d) => (
        <div className="stack g16">
          <section className="card stack g8" aria-label="Off switch" data-testid="aa-switch">
            <div className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <strong data-testid="aa-switch-state">{d.settings.on ? 'Auto Apply is on for everyone' : 'Auto Apply is OFF: nothing is applied or sent'}</strong>
              {d.settings.on
                ? !off && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setOff(true)}>Turn off for everyone</button>
                : <button type="button" className="btn btn-ink" disabled={busy} onClick={() => save({ ...d.settings, on: true }, 'Auto Apply is on')}>Turn on</button>}
            </div>
            {off && (
              <div className="row g8 well" role="alert" style={{ flexWrap: 'wrap' }}>
                <span className="small">Nothing will be applied or sent for anyone until you turn it on again. Students’ settings are kept.</span>
                <button type="button" className="btn btn-ink" disabled={busy} onClick={() => save({ ...d.settings, on: false }, 'Auto Apply is off')} data-testid="aa-off-confirm">Turn off</button>
                <button type="button" className="link-btn small" onClick={() => setOff(false)}>Cancel</button>
              </div>
            )}
          </section>
          <div className="kpis">
            <Kpi label="Students on" value={d.students.on} sub={`${d.students.paused} paused`} />
            <Kpi label="Need an answer" value={d.stuck} sub={`${d.ready} ready to apply`} />
            <Kpi label="Emails waiting (cap)" value={d.waitingCap} sub={`${d.emailBlocks} blocked addresses / domains`} />
            <Kpi label="“Not relevant” marks" value={d.irrelevantMarks} sub="by companies" />
          </div>
          <Panel title="Applications per day">
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Applications per day">
              <table className="table" data-testid="aa-days"><thead><tr><th scope="col">Day</th><th scope="col" style={NUM}>Auto</th><th scope="col" style={NUM}>Manual</th><th scope="col" style={NUM}>Emails sent</th><th scope="col" style={NUM}>Bounced</th><th scope="col" style={NUM}>Complaints</th></tr></thead>
                <tbody>{d.days.length === 0 ? <tr><td colSpan={6} className="small muted">No applications yet.</td></tr> : d.days.map((r) => (
                  <tr key={r.day}><th scope="row" className="small" style={{ fontWeight: 400 }}>{r.day}</th><Count o={r.auto} /><Count o={r.manual} /><td style={NUM}>{r.sent}</td><td style={NUM}>{r.bounced}</td><td style={NUM}>{r.complained}</td></tr>
                ))}</tbody></table>
            </div>
          </Panel>
          <Defaults key={JSON.stringify(d.settings)} s={d.settings} busy={busy} onSave={(s) => save(s, 'Saved')} />
          <Students toast={toast} />
          <Companies toast={toast} />
          <Panel title="Run log">
            <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="aa-runs">
              {d.runs.length === 0 && <li className="small muted">No runs yet. The run starts at 07:00 IST.</li>}
              {d.runs.map((r) => (
                <li key={r.day} className="card-sm stack g4">
                  <strong className="small">{r.day} · {r.users} students · {when(r.at)}</strong>
                  <span className="xs muted">{Object.entries(r.counts).filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(' · ') || 'nothing to do'}</span>
                  {r.errors.map((e, i) => <span key={i} className="xs" style={{ color: 'var(--danger)' }}>Error ({e.user}): {e.error}</span>)}
                </li>
              ))}
            </ul>
          </Panel>
          <section className="card-sm stack g8" aria-label="Demo student" data-testid="aa-demo">
            <strong className="small">Demo student</strong>
            <span className="xs muted">A made-up student with Auto Apply on and one of each: applied on Nm7, sent by email (recorded, not sent), needs your answer, ready to apply, against the demo company’s jobs. Never public. Opening it signs this browser in as the student (the admin console signs out here: use a private window to keep both).</span>
            <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => demo()} data-testid="aa-demo-open">Reset and open as student (Auto Apply)</button>
            <span className="xs muted">Easy dashboard: Ravi Kumar (demo) uses the simple dashboard in {raviLang}, with a half-done resume (no project yet), a job readiness score near 60%, the demo company’s jobs and one question waiting. Never public.</span>
            <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => demo('/api/admin/simple/demo')} data-testid="aa-demo-simple">Reset and open as student (Easy dashboard, {raviLang})</button>
          </section>
        </div>
      )}</Loading>
    </>
  );
}

function Defaults({ s, busy, onSave }) {
  const [f, setF] = useState(() => Object.fromEntries(FIELDS.map(([k]) => [k, String(s[k] ?? '')])));
  const bad = FIELDS.some(([k, , lo, hi]) => !/^\d+$/.test(f[k]) || Number(f[k]) < lo || Number(f[k]) > hi);
  return (
    <Panel title="Defaults">
      <form className="stack g8" onSubmit={(e) => { e.preventDefault(); onSave({ ...s, ...Object.fromEntries(FIELDS.map(([k]) => [k, Number(f[k])])) }); }} data-testid="aa-defaults">
        {FIELDS.map(([k, label, lo, hi]) => (
          <label key={k} className="row g8 small" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>{label}
            <input className="input" type="number" inputMode="numeric" min={lo} max={hi} step={1} style={{ height: 38, width: 110 }} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`aa-${k}`} /></label>
        ))}
        {bad && <span className="xs" style={{ color: 'var(--danger)' }}>Each value must be a whole number in its range.</span>}
        <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy || bad}>Save defaults</button>
      </form>
    </Panel>
  );
}

function PauseRow({ label, sub, paused, onPause }) {
  const [ask, setAsk] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <li className="card-sm stack g4">
      <div className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span className="small" style={{ overflowWrap: 'anywhere' }}><strong>{label}</strong> · {sub}</span>
        {paused ? <button type="button" className="btn btn-outline" onClick={() => onPause(false, '')}>Resume</button>
          : !ask && <button type="button" className="btn btn-outline" onClick={() => setAsk(true)}>Pause</button>}
      </div>
      {ask && !paused && (
        <form className="row g8" onSubmit={(e) => { e.preventDefault(); onPause(true, reason); setAsk(false); }}>
          <input className="input" style={{ flex: '1 1 200px', height: 38 }} maxLength={200} placeholder="Why (kept in the activity log)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why" />
          <button type="submit" className="btn btn-ink">Pause</button><button type="button" className="link-btn small" onClick={() => setAsk(false)}>Cancel</button>
        </form>
      )}
    </li>
  );
}

function Students({ toast }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [busy, run] = useAction(toast);
  const load = (x = q) => http(`/api/admin/auto-apply/users?q=${encodeURIComponent(x)}`).then(setRows, () => setRows([]));
  useEffect(() => { load(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Panel title="Students">
      <form className="row g8" role="search" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <label className="sr-only" htmlFor="aa-uq">Find a student</label>
        <input id="aa-uq" className="input" style={{ flex: '1 1 220px', height: 40 }} placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-outline" disabled={busy}>Search</button>
      </form>
      <ul className="stack g8" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }} data-testid="aa-students">
        {rows && rows.length === 0 && <li className="small muted">No students with Auto Apply here.</li>}
        {(rows || []).map((u) => (
          <PauseRow key={u.id} label={u.name || u.email} sub={`${u.email} · ${u.adminPaused ? `paused by Admin${u.reason ? `: ${u.reason}` : ''}` : u.on ? 'on' : 'paused by the student'} · ${u.applied} applied · ${u.stuck} need an answer${u.blockedCompanies ? ` · stopped at ${u.blockedCompanies} compan${u.blockedCompanies === 1 ? 'y' : 'ies'}` : ''}`}
            paused={u.adminPaused} onPause={(paused, reason) => run(async () => { await http(`/api/admin/auto-apply/users/${u.id}/pause`, { method: 'POST', body: { paused, reason } }); load(); }, paused ? 'Student paused' : 'Student resumed')} />
        ))}
      </ul>
    </Panel>
  );
}

function Companies({ toast }) {
  const st = useApi('/api/admin/auto-apply/companies');
  const [, run] = useAction(toast);
  return (
    <Panel title="Companies receiving auto applications">
      <Loading st={st}>{(rows) => (
        <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="aa-companies">
          {rows.length === 0 && <li className="small muted">None yet.</li>}
          {rows.map((c) => (
            <PauseRow key={c.id} label={c.name} sub={`${c.auto} auto applications · ${c.marks} marked “Not relevant”${c.paused ? ' · paused' : ''}`} paused={c.paused}
              onPause={(paused, reason) => run(async () => { await http(`/api/admin/auto-apply/companies/${c.id}/pause`, { method: 'POST', body: { paused, reason } }); st.reload(); }, paused ? 'Company paused' : 'Company resumed')} />
          ))}
        </ul>
      )}</Loading>
    </Panel>
  );
}
