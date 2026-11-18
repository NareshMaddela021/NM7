// Admin → Auto Apply (Phase 3, A7): applications per day (Auto vs Manual, by channel), emails sent / bounced /
// complaints, students on / paused, stuck items, company "Not relevant" marks, the run log with errors; the off switch
// (off = nothing is applied or sent), every default, pause a student or a company, and the demo shortcut. All on the
// page, no pop-up dialogs; everything is in the activity log.
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { Kpi, PageHead, Panel } from '../AdminUI';
import { langsShown, useLang } from '../../../lib/i18n';
import { Loading, http, useAction, useApi, when } from './common';
import '../../../styles/me-kit.css';
import '../../../styles/admin-jobs.css';

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
  const demo = (url = '/api/admin/auto-apply/demo', body) => run(async () => { const r = await http(url, { method: 'POST', body }); window.location.assign(r.path); });
  return (
    <div className="adx adx-aa stack g16">
      <PageHead title="Auto Apply" sub="Every morning Nm7 applies for students within their own rules. Nothing is ever submitted on other websites by a bot." />
      <V2Admin toast={toast} />
      <EmailHealth toast={toast} />
      <PartnerHealth />
      <Loading st={st}>{(d) => (
        <div className="stack g16">
          <section className="card stack g8 adx-switch" data-on={d.settings.on ? '1' : '0'} aria-label="Off switch" data-testid="aa-switch">
            <div className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <strong data-testid="aa-switch-state">{d.settings.on ? 'Auto Apply is on for everyone' : 'Auto Apply is OFF: nothing is applied or sent'}</strong>
              {d.settings.on
                ? !off && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setOff(true)}>Turn off for everyone</button>
                : <button type="button" className="btn btn-signal" disabled={busy} onClick={() => save({ ...d.settings, on: true }, 'Auto Apply is on')}>Turn on</button>}
            </div>
            {off && (
              <div className="row g8 well" role="alert" style={{ flexWrap: 'wrap' }}>
                <span className="small">Nothing will be applied or sent for anyone until you turn it on again. Students’ settings are kept.</span>
                <button type="button" className="btn btn-signal" disabled={busy} onClick={() => save({ ...d.settings, on: false }, 'Auto Apply is off')} data-testid="aa-off-confirm">Turn off</button>
                <button type="button" className="link-btn small" onClick={() => setOff(false)}>Cancel</button>
              </div>
            )}
          </section>
          <div className="kpis adx-kpis">
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
                <li key={r.day} className="card-sm stack g4 adx-log">
                  <strong className="small">{r.day} · {r.users} students · {when(r.at)}</strong>
                  <span className="xs muted">{Object.entries(r.counts).filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(' · ') || 'nothing to do'}</span>
                  {r.errors.map((e, i) => <span key={i} className="xs" style={{ color: 'var(--danger)' }}>Error ({e.user}): {e.error}</span>)}
                </li>
              ))}
            </ul>
          </Panel>
          {/* long labels wrap on a phone instead of running off the screen (re-test N5 follow-up) */}
          <section className="card-sm stack g8 adx-demo" aria-label="Demo student" data-testid="aa-demo">
            <strong className="small">Demo student</strong>
            <span className="xs muted">A made-up student (Kavya) with Auto Apply on and one of each: applied on Nm7, sent by email (recorded, not sent), needs your answer, ready to apply, against the demo company’s jobs. Auto Apply 2.0 too: every tracker state, the approval list, waiting questions and suggested jobs (Open Auto Apply 2.0 on her page). Never public. Opening it signs this browser in as the student (the admin console signs out here: use a private window to keep both).</span>
            <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start', maxWidth: '100%', whiteSpace: 'normal', textAlign: 'left', height: 'auto', minHeight: 40 }} disabled={busy} onClick={() => demo()} data-testid="aa-demo-open">Reset and open as student (Auto Apply)</button>
            <span className="xs muted">Easy dashboard: Ravi Kumar (demo) uses the simple dashboard in {raviLang}, with a half-done resume (no project yet), a job readiness score near 60%, the demo company’s jobs and one question waiting. Never public.</span>
            <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start', maxWidth: '100%', whiteSpace: 'normal', textAlign: 'left', height: 'auto', minHeight: 40 }} disabled={busy} onClick={() => demo('/api/admin/simple/demo')} data-testid="aa-demo-simple">Reset and open as student (Easy dashboard, {raviLang})</button>
            <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start', maxWidth: '100%', whiteSpace: 'normal', textAlign: 'left', height: 'auto', minHeight: 40 }} disabled={busy} onClick={() => demo('/api/admin/seek/demo', { who: 'meera' })} data-testid="aa-demo-meera">Reset and open as student (Phase 6: Meera, learning and proving skills)</button>
            <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start', maxWidth: '100%', whiteSpace: 'normal', textAlign: 'left', height: 'auto', minHeight: 40 }} disabled={busy} onClick={() => demo('/api/admin/seek/demo', { who: 'arjun' })} data-testid="aa-demo-arjun">Reset and open as student (Phase 6: Arjun, day 10 at a new job)</button>
          </section>
        </div>
      )}</Loading>
    </div>
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
        <button type="submit" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={busy || bad}>Save defaults</button>
      </form>
    </Panel>
  );
}

function PauseRow({ label, sub, paused, onPause }) {
  const [ask, setAsk] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <li className="card-sm stack g4 adx-row" data-status={paused ? 'paused' : 'active'}>
      <div className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span className="small" style={{ overflowWrap: 'anywhere' }}><strong>{label}</strong> · {sub}</span>
        {paused ? <button type="button" className="btn btn-outline" onClick={() => onPause(false, '')}>Resume</button>
          : !ask && <button type="button" className="btn btn-outline" onClick={() => setAsk(true)}>Pause</button>}
      </div>
      {ask && !paused && (
        <form className="row g8" onSubmit={(e) => { e.preventDefault(); onPause(true, reason); setAsk(false); }}>
          <input className="input" style={{ flex: '1 1 200px', height: 38 }} maxLength={200} placeholder="Why (kept in the activity log)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why" />
          <button type="submit" className="btn btn-signal">Pause</button><button type="button" className="link-btn small" onClick={() => setAsk(false)}>Cancel</button>
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

// Auto Apply 2.0 (A1 "Engine"): its own launch switch (OFF = only admins, demo accounts and the testers below), the
// match thresholds, the daily limit and its maximum, pricing (free for now) and the numbers. Everything is logged.
const V2_FIELDS = [
  ['autoMin', 'Match score that may be applied to automatically', 50, 100], ['suggestMin', '“Suggested for you” from this score', 30, 100],
  ['dailyLimit', 'New users’ applications a day', 1, 50], ['maxDailyLimit', 'Most a user may choose', 1, 50],
  ['freePerWeek', 'Free applications a week (0 = no weekly limit)', 0, 500], ['paidLimit', 'Paid plan: applications a week (0 = not set)', 0, 1000],
];

function V2Admin({ toast }) {
  const st = useApi('/api/admin/auto-apply/v2');
  const [busy, run] = useAction(toast);
  const save = (s, msg) => run(async () => { await http('/api/admin/auto-apply/v2/settings', { method: 'PUT', body: s }); st.reload(); }, msg);
  return (
    <Loading st={st}>{(d) => <V2Form key={JSON.stringify(d.settings)} d={d} busy={busy} save={save} />}</Loading>
  );
}

function V2Form({ d, busy, save }) {
  const s = d.settings;
  const [f, setF] = useState(() => ({ ...Object.fromEntries(V2_FIELDS.map(([k]) => [k, String(s[k] ?? '')])), testers: (s.testers || []).join(', '), paymentsOn: !!s.paymentsOn, testInbox: s.testInbox || '' }));
  const bad = V2_FIELDS.some(([k, , lo, hi]) => !/^\d+$/.test(f[k]) || Number(f[k]) < lo || Number(f[k]) > hi);
  const body = (over = {}) => ({ ...s, ...Object.fromEntries(V2_FIELDS.map(([k]) => [k, Number(f[k])])), testers: f.testers.split(/[\s,]+/).filter(Boolean), paymentsOn: f.paymentsOn, testInbox: f.testInbox.trim(), ...over });
  const x = d.stats;
  return (
    <Panel title="Auto Apply 2.0">
      <div className="stack g12" data-testid="aa2-admin">
        <div className="row g8 adx-switch" data-on={s.public ? '1' : '0'} style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <strong className="small" data-testid="aa2-admin-state">{s.public ? 'Public: every user gets Auto Apply 2.0' : 'Hidden: only admins, demo accounts and the testers below. Real users see nothing new and get no 2.0 email.'}</strong>
          <button type="button" className={`btn ${s.public ? 'btn-outline' : 'btn-signal'}`} disabled={busy || bad} onClick={() => save(body({ public: !s.public }), s.public ? 'Hidden again' : 'Auto Apply 2.0 is public')} data-testid="aa2-admin-switch">{s.public ? 'Hide again' : 'Make public'}</button>
        </div>
        <div className="kpis adx-kpis">
          <Kpi label="Opted in" value={x.optedIn} sub={`${x.paused} paused`} />
          <Kpi label="Modes" value={x.modes.approve} sub={`approve each · ${x.modes.full_auto} full auto · ${x.modes.digest} weekly`} />
          <Kpi label="Sent with 2.0" value={x.applied} sub={`${x.items.waiting_approval || 0} waiting for approval`} />
          <Kpi label="Tailored versions" value={Object.values(x.versions).reduce((a, b) => a + b, 0)} sub={`${x.versions.ai || 0} AI · ${x.blocked} AI drafts blocked by the truth check`} />
        </div>
        <form className="stack g8" onSubmit={(e) => { e.preventDefault(); save(body(), 'Saved'); }} data-testid="aa2-admin-form">
          {V2_FIELDS.map(([k, label, lo, hi]) => (
            <label key={k} className="row g8 small" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>{label}
              <input className="input" type="number" inputMode="numeric" min={lo} max={hi} step={1} style={{ height: 38, width: 110 }} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`aa2-${k}`} /></label>
          ))}
          <label className="stack g4 small">Testers (emails, comma between)
            <textarea className="input" rows={2} style={{ minHeight: 60, maxWidth: '100%' }} value={f.testers} onChange={(e) => setF({ ...f, testers: e.target.value })} data-testid="aa2-testers" /></label>
          <label className="stack g4 small">Test inbox for Auto Apply emails while hidden (empty = each tester’s own inbox). A company is never emailed while hidden.
            <input className="input" type="email" style={{ height: 38, maxWidth: 360 }} value={f.testInbox} onChange={(e) => setF({ ...f, testInbox: e.target.value })} placeholder="qa@yourmail.com" data-testid="aa2-test-inbox" /></label>
          <label className="row g8 small"><input type="checkbox" checked={f.paymentsOn} onChange={(e) => setF({ ...f, paymentsOn: e.target.checked })} /> Payments on (off: free for everyone)</label>
          {bad && <span className="xs" style={{ color: 'var(--danger)' }}>Each value must be a whole number in its range.</span>}
          <button type="submit" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={busy || bad} data-testid="aa2-admin-save">Save Auto Apply 2.0</button>
        </form>
      </div>
    </Panel>
  );
}

// Auto Apply 2.0 email applications (A3): the channel's health (on / off and what the server is missing, sent today,
// bounce and complaint rates over 30 days), blocked addresses and domains with the employers' opt-outs (undo any), and
// candidates whose email channel was paused after a complaint (turn it back on after a look). The DNS steps for
// apply.nm7.si are in docs/autoapply/apply-nm7-si-dns.md.
const REASON = { bounce: 'Bounced', complaint: 'Complaint', opt_out: 'Opted out' };

function EmailHealth({ toast }) {
  const st = useApi('/api/admin/auto-apply/v2/email');
  const [busy, run] = useAction(toast);
  const [show, setShow] = useState(false);
  const act = (url, method, msg) => run(async () => { await http(url, { method }); st.reload(); }, msg);
  return (
    <Panel title="Auto Apply 2.0: email channel">
      <Loading st={st}>{(d) => (
        <div className="stack g12" data-testid="aa2-email-admin">
          <div className="row g8 adx-switch" data-on={d.channel.on ? '1' : '0'} style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <strong className="small" data-testid="aa2-email-admin-state">{d.channel.on ? `On: candidates’ apply addresses on ${d.channel.domain}` : `Off: ${d.channel.reason} Email jobs fall back to Ready (one tap).`}</strong>
            <span className="xs muted">{d.public ? 'Public: emails go to companies' : `Hidden: emails go to ${d.testInbox || 'each tester’s own inbox'}, never to a company`}</span>
          </div>
          {d.channel.missing.length > 0 && <p className="xs" style={{ margin: 0 }} data-testid="aa2-email-missing">Missing on the server (Render): {d.channel.missing.join(', ')}. See docs/autoapply/apply-nm7-si-dns.md.</p>}
          <div className="kpis adx-kpis">
            <Kpi label="Sent today" value={d.sentToday} sub={`${d.testToday} to the test inbox · limits ${d.limits.perCandidateDay}/candidate, ${d.limits.perDomainDay}/company domain a day`} />
            <Kpi label="Bounces (30 days)" value={`${d.bounceRate}%`} sub={`${d.bounces30} of ${d.sent30} emails`} />
            <Kpi label="Complaints (30 days)" value={`${d.complaintRate}%`} sub={`${d.complaints30} of ${d.sent30} emails`} />
            <Kpi label="Blocked" value={d.blocks.length} sub={`${d.blockedDomains} domains · ${d.optOuts} employer opt-outs · ${d.replies30} replies in 30 days`} />
          </div>
          {d.paused.length > 0 && (
            <section className="stack g8" aria-label="Paused after a complaint" data-testid="aa2-email-paused-list">
              <strong className="small">Candidates paused after a complaint</strong>
              {d.paused.map((u) => (
                <div key={u.id} className="row g8 well" style={{ justifyContent: 'space-between', flexWrap: 'wrap', overflowWrap: 'anywhere' }}>
                  <span className="small">{u.name || u.email} <span className="muted">· {u.email} · {when(u.at)}</span></span>
                  <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => act(`/api/admin/auto-apply/v2/email/paused/${u.id}/resume`, 'POST', 'Email channel back on')}>Turn back on</button>
                </div>
              ))}
            </section>
          )}
          <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} aria-expanded={show} onClick={() => setShow(!show)} data-testid="aa2-email-blocks-toggle">{show ? 'Hide' : 'Show'} blocked addresses and opt-outs ({d.blocks.length})</button>
          {show && (d.blocks.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Nothing is blocked.</p> : (
            <ul className="stack g4" style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="aa2-email-blocks">
              {d.blocks.map((b) => (
                <li key={b.id} className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap', overflowWrap: 'anywhere', borderBottom: '1px solid var(--border2)', padding: '6px 0' }} data-testid="aa2-email-block">
                  <span className="small"><strong>{b.id}</strong> <span className="muted">· {b.kind === 'domain' ? 'whole domain' : 'one address'} · {REASON[b.reason] || b.reason} · {when(b.at)}</span></span>
                  <button type="button" className="link-btn small" disabled={busy} onClick={() => act(`/api/admin/auto-apply/v2/email/blocks/${encodeURIComponent(b.id)}`, 'DELETE', 'Removed from the list')} data-testid="aa2-email-unblock">Undo</button>
                </li>
              ))}
            </ul>
          ))}
        </div>
      )}</Loading>
    </Panel>
  );
}

// Auto Apply 2.0 (A4): each hiring-system partner's health. Companies connect with their own keys on their dashboard
// ("Connect your hiring system"); this shows only counts, the last error's kind and dates, never a key or a company's
// settings. Darwinbox is marked until Darwinbox confirms its API.
const ERROR_KIND = { auth: 'Key refused', not_found: 'Account or job not found', rate_limited: 'Rate limited', server: 'Partner error', network: 'Unreachable', bad_request: 'Request refused', config: 'Settings missing', error: 'Other error' };

function PartnerHealth() {
  const st = useApi('/api/admin/auto-apply/v2/partners');
  return (
    <Panel title="Auto Apply 2.0: hiring systems">
      <Loading st={st}>{(d) => (
        <div className="stack g8" data-testid="aa2-partners-admin">
          <span className="xs muted">{d.public ? 'Public: applications to linked jobs go to the companies’ own systems.' : 'Hidden: only testers’ applications reach companies with a tester on their team; demo stays with the demo company.'}</span>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Hiring systems">
            <table className="table" data-testid="aa2-partners"><thead><tr><th scope="col">System</th><th scope="col" style={NUM}>Companies</th><th scope="col" style={NUM}>Delivered today</th><th scope="col" style={NUM}>Retrying / failed</th><th scope="col">Last error</th><th scope="col">Last sync</th></tr></thead>
              <tbody>{d.partners.map((p) => (
                <tr key={p.key} data-testid="aa2-partner" data-key={p.key}>
                  <th scope="row" className="small" style={{ fontWeight: 600 }}>{p.name}{!p.confirmed && <div className="xs muted">needs Darwinbox to confirm its API</div>}</th>
                  <td style={NUM}>{p.connected}{p.demo > 0 && <div className="xs muted">+{p.demo} demo</div>}</td>
                  <td style={NUM} data-testid="aa2-partner-today">{p.deliveredToday}</td>
                  <td style={NUM}>{p.retrying} / {p.failures}</td>
                  <td className="small">{p.lastErrorType ? <>{ERROR_KIND[p.lastErrorType] || p.lastErrorType}<div className="xs muted">{when(p.lastErrorAt)}</div></> : '—'}</td>
                  <td className="small">{p.lastSyncAt ? when(p.lastSyncAt) : '—'}</td>
                </tr>
              ))}</tbody></table>
          </div>
        </div>
      )}</Loading>
    </Panel>
  );
}
