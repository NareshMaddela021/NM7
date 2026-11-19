// /me/auto-apply/v2: Auto Apply 2.0 (A1 "Engine"), shown only while Admin's launch switch lets this person in (admins,
// demo accounts, testers; everyone once public). One page, five tabs: the tracker for every channel (Ready, Waiting for
// you, Applied, Viewed, Replied / Interview, Offer / Rejected / Closed, with the channel's icon and "What was sent"),
// the approval list ("Approve all"), the Waiting questions (answers saved to the profile, then sent at once),
// "Suggested for you" (55–69) and the rules form with the approval mode and the explicit opt-in (pause / stop any
// time). English only while it is tested. No pop-up dialogs; nothing scrolls sideways at 390 px.
// A3: the Email tab (the email channel on / off, the follow-up opt-in, the candidate's own apply address, replies that
// came back) and, in "What was sent", the exact email with its attachment, any follow-up and the replies.
// A7: the Replies tab (every channel, unread markers, interview invites) and This week (the weekly summary).
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useToast } from '../../components/ui';
import { EXPERIENCE, JOB_TYPES } from '../../lib/jobBoard';
import { http } from '../../services/http';
import OneTap from './AutoApplyOneTap';
import { Inbox, Week } from './AutoApplyReplies';
import { MeHead } from './MeLayout';
import { Chip, Empty, FieldGroup, Skel, StickyBar } from './kit';
import '../../styles/me-jobs.css';
import '../../styles/me-aa2.css';
import { IcMail } from '../../components/icons';

const BASE = '/api/me/auto-apply/v2';
export const CHANNELS = {
  internal: 'On Nm7', email: 'Email', partner: 'Partner', form: 'Company form', one_tap: 'One tap',
};
const STAGE_TONE = { ready: 'accent', waiting: 'warn', applied: 'info', viewed: 'info', replied: 'ok', closed: 'neutral' };
const OUTCOME = { replied: 'Replied', offer: 'Offer', rejected: 'Rejected', closed: 'Job closed', interview: 'Interview', shortlisted: 'Shortlisted', no_reply: 'No reply' };
const MODES = [
  ['approve', 'Approve each', 'Every morning you get a list. Nothing goes out until you tap Approve (or Approve all).'],
  ['full_auto', 'Full auto', 'Nm7 applies for you within your rules and daily limit. You can see everything it sent.'],
  ['digest', 'Weekly digest', 'Jobs collect in one list for the week. You approve them when it suits you.'],
];
const NOTICE = [['', 'Not set'], ['immediate', 'Immediately'], ['15_days', '15 days'], ['30_days', '30 days'], ['60_days', '60 days'], ['90_days', '90 days']];
const EXP_LABEL = { internship: 'Internship', fresher: 'Fresher', '0_1': '0–1 years', '1_3': '1–3 years', '3_5': '3–5 years', '5_8': '5–8 years', '8_12': '8–12 years', '12_15': '12–15 years', '15_plus': '15+ years' };
const TYPE_LABEL = { full_time: 'Full-time', internship: 'Internship', contract: 'Contract', part_time: 'Part-time' };
const TABS = [['tracker', 'Tracker'], ['replies', 'Replies'], ['week', 'This week'], ['ready', 'Jobs ready'], ['approve', 'Approve'], ['waiting', 'Waiting for you'], ['suggested', 'Suggested'], ['email', 'Email'], ['rules', 'Rules']];
const fmtAt = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export function ChannelTag({ channel, partner }) {
  const label = CHANNELS[channel] || CHANNELS.internal;
  const name = channel === 'partner' && partner?.name ? ` · ${partner.name}` : '';
  return <span className="aa2-ch" data-channel={channel} data-testid="aa2-ch">{label}{name}</span>;
}

function JobHead({ it }) {
  return (
    <div className="aa2-job">
      <span className="mavatar" aria-hidden="true">{(it.job.company || '?').slice(0, 1).toUpperCase()}</span>
      <span className="stack g4" style={{ minWidth: 0 }}>
        {it.demo ? <strong className="aa2-title">{it.job.title}</strong> : <Link to={`/jobs/${it.job.slug}`} className="aa2-title">{it.job.title}</Link>}
        <span className="xs muted aa2-wrap">{it.job.company}{it.score != null ? ` · match ${it.score}` : ''}</span>
      </span>
    </div>
  );
}

function Parts({ it }) {
  const parts = Object.entries(it.parts || {});
  if (!parts.length) return null;
  return (
    <details className="aa2-parts">
      <summary className="xs">Why this score</summary>
      <ul className="aa2-partlist">
        {parts.map(([k, p]) => <li key={k} className="xs"><strong>{p.points}/{p.max}</strong> {k[0].toUpperCase() + k.slice(1)}: {p.note}</li>)}
      </ul>
    </details>
  );
}

function Version({ v }) {
  if (!v) return <p className="xs muted" style={{ margin: 0 }}>No tailored version yet.</p>;
  return (
    <div className="stack g8 aa2-version" data-testid="aa2-version">
      <span className="xs muted">{v.source === 'ai' ? 'Tailored with AI, checked against your resume' : 'Your resume, reordered for this job (rules version)'}{v.truth.blocked ? ' · the AI draft added something not on your resume, so it was not used' : ''}</span>
      {v.changes.length > 0 && <ul className="xs aa2-plain">{v.changes.map((c) => <li key={c.kind}>{c.label}</li>)}</ul>}
      <strong className="small">Cover note</strong>
      <div className="aa2-note small" data-testid="aa2-cover">{v.coverNote.map((l, i) => <p key={i}>{l}</p>)}</div>
      {v.answers.length > 0 && (
        <>
          <strong className="small">Ready answers</strong>
          <dl className="aa2-answers small">{v.answers.map((a) => <div key={a.question}><dt>{a.question}</dt><dd>{a.answer}</dd></div>)}</dl>
        </>
      )}
      {v.resume?.summary && <><strong className="small">Summary on the resume</strong><p className="small" style={{ margin: 0 }}>{v.resume.summary}</p></>}
    </div>
  );
}

function WhatWasSent({ id }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { http(`${BASE}/sent/${id}`).then(setD).catch((x) => setErr(x.message)); }, [id]);
  if (err) return <p className="error" role="alert">{err}</p>;
  if (!d) return <Skel cards={1} lines={2} />;
  return (
    <div className="stack g8" data-testid="aa2-sent">
      <span className="xs muted">{d.wentOut ? 'This went out to the company:' : 'Not sent yet. This is what will go out:'}</span>
      {d.email && <SentEmail e={d.email} />}
      {d.form && <SentForm f={d.form} />}
      {d.followUp && <><strong className="small">Follow-up</strong><SentEmail e={d.followUp} /></>}
      {d.replies?.length > 0 && <Replies rows={d.replies} />}
      <Version v={d.version} />
      {Object.keys(d.screening).length > 0 && <span className="xs muted">Screening answers sent: {Object.values(d.screening).join(', ')}</span>}
    </div>
  );
}

function SentEmail({ e }) {
  const own = e.source?.kind === 'company_account';
  return (
    <div className="aa2-note small" data-testid="aa2-email">
      {e.test && <p className="xs muted" data-testid="aa2-email-test">Test: Auto Apply 2.0 is being tested, so this went to {e.sentTo}, not to the company.</p>}
      {e.from && <p><strong>From:</strong> {e.from}</p>}
      <p><strong>To:</strong> {e.to}</p>
      <p><strong>Subject:</strong> {e.subject}</p>
      {e.attachment && <p data-testid="aa2-email-attachment"><strong>Attached:</strong> {e.attachment} (your tailored resume)</p>}
      <p className="aa2-pre">{e.text}</p>
      {e.source?.kind && <p className="xs muted">{own ? 'The company published this address in its own job post on Nm7.' : 'The company published this address on its own page'}{!own && e.source.url ? <>: <span className="aa2-wrap">{e.source.url}</span></> : null}</p>}
    </div>
  );
}

// A5: what went to the company's own form: the fields, the resume file, the site's answer and a copy of its page
function SentForm({ f }) {
  return (
    <div className="aa2-note small stack g4" data-testid="aa2-form">
      {f.test && <p className="xs muted" data-testid="aa2-form-test">Test: Auto Apply 2.0 is being tested. This went to a test company’s own form.</p>}
      <p data-testid="aa2-form-result"><strong>{f.ok ? (f.confirmed ? 'Sent. The company’s page confirmed it.' : 'Sent. The company’s page didn’t say clearly that it got it.') : 'Nm7 tried the company’s form, but it didn’t go through. Apply yourself with one tap.'}</strong></p>
      <p className="aa2-wrap"><strong>Form on:</strong> {f.page}</p>
      {f.fields.length > 0 && (
        <dl className="aa2-answers" data-testid="aa2-form-fields">
          {f.fields.filter((x) => x.kind !== 'hidden').map((x, i) => <div key={`${x.label}-${i}`}><dt>{x.label}</dt><dd className="aa2-pre">{x.value}</dd></div>)}
        </dl>
      )}
      {f.file && <p data-testid="aa2-form-file"><strong>Attached:</strong> {f.file.name} (your tailored resume)</p>}
      <p className="xs muted" data-testid="aa2-form-status">{f.status != null ? `The site answered with HTTP ${f.status}` : 'The site didn’t answer'}{f.finalUrl ? <> · <span className="aa2-wrap">{f.finalUrl}</span></> : null}{f.at ? ` · ${fmtAt(f.at)}` : ''}</p>
      {f.snapshot && <details><summary className="xs">The company’s page after sending</summary><p className="aa2-pre xs" data-testid="aa2-form-snapshot">{f.snapshot}</p></details>}
    </div>
  );
}

function Replies({ rows }) {
  return (
    <section className="stack g8" aria-label="Replies" data-testid="aa2-replies">
      <strong className="small">Replies ({rows.length})</strong>
      <ul className="stack g8 aa2-list">
        {rows.map((r) => (
          <li key={r.id} className="aa2-note small" data-testid="aa2-reply">
            <p><strong>{r.fromName || r.from}</strong>{r.fromName ? <span className="muted"> · {r.from}</span> : null}</p>
            <p className="xs muted">{fmtAt(r.at)}{r.title ? ` · ${r.title} at ${r.company}` : ''}{r.forwarded ? ' · also sent to your email' : ''}</p>
            {r.subject && <p><strong>{r.subject}</strong></p>}
            <p className="aa2-pre">{r.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TrackerRow({ it, onChanged, toast }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const mark = async (status) => {
    setBusy(true);
    try { await http(`${BASE}/tracker/${it.id}/status`, { method: 'POST', body: { status } }); toast('Saved'); onChanged(); } catch (x) { toast(x.message); } finally { setBusy(false); }
  };
  const outside = ['email', 'one_tap', 'form'].includes(it.channel) && ['applied', 'viewed', 'replied'].includes(it.stage);
  return (
    <li className="mcard mcard-tight stack g8 aa2-row" data-testid="aa2-row" data-stage={it.stage}>
      <div className="aa2-rowtop">
        <JobHead it={it} />
        <span className="aa2-tags"><Chip tone={STAGE_TONE[it.stage]}>{it.outcome ? OUTCOME[it.outcome] || it.outcome : TABS_STAGE[it.stage]}</Chip><ChannelTag channel={it.channel} partner={it.partner} /></span>
      </div>
      {it.partner && <span className="xs muted aa2-wrap" data-testid="aa2-row-partner">{it.partner.state === 'kept' ? `Not delivered to ${it.partner.name}: it stays in the company’s Nm7 dashboard.` : `${it.partner.stateText} to the company’s hiring system (${it.partner.name}). It is in their Nm7 dashboard too.`}</span>}
      {it.form?.text && <span className="xs muted aa2-wrap" data-testid="aa2-row-form">{it.form.text}{it.form.ok && it.form.confirmed ? '. The company’s page confirmed it.' : ''}</span>}
      {it.readyText && <span className="xs muted aa2-wrap" data-testid="aa2-row-ready">{it.readyText}</span>}
      {it.notice && <span className="xs muted aa2-wrap" data-testid="aa2-row-notice">{it.notice.text}</span>}
      {it.replies > 0 && <span className="xs aa2-wrap" data-testid="aa2-row-replies"><IcMail size={14} /> {it.replies} {it.replies === 1 ? 'reply' : 'replies'} to your apply address: open “What was sent”</span>}
      {it.applyTo && <span className="xs muted aa2-wrap" data-testid="aa2-row-applyto">Apply by email yourself: <a href={`mailto:${it.applyTo}`}>{it.applyTo}</a> (attach your tailored resume)</span>}
      <Parts it={it} />
      <div className="row g8 aa2-actions">
        {it.hasVersion && <button type="button" className="link-btn small" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="aa2-what">{open ? 'Hide what was sent' : 'What was sent'}</button>}
        {outside && <>
          <button type="button" className="link-btn small" disabled={busy} onClick={() => mark('interview')}>They replied</button>
          <button type="button" className="link-btn small" disabled={busy} onClick={() => mark('rejected')}>Rejected</button>
        </>}
      </div>
      {open && <WhatWasSent id={it.id} />}
    </li>
  );
}
const TABS_STAGE = { ready: 'Ready', waiting: 'Waiting for you', applied: 'Applied', viewed: 'Viewed', replied: 'Replied / Interview', closed: 'Closed' };

function Tracker({ toast, focus, onAll }) {
  const [d, setD] = useState(null);
  const [pick, setPick] = useState(null);
  const load = useCallback(() => http(`${BASE}/tracker`).then(setD).catch(() => setD({ stages: [], items: [] })), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Skel cards={2} />;
  const focused = focus && d.items.some((x) => x.id === focus);
  const rows = focused ? d.items.filter((x) => x.id === focus) : pick ? d.items.filter((x) => x.stage === pick) : d.items;
  const seen = async () => { try { await http(`${BASE}/tracker/seen`, { method: 'POST' }); } catch { /* shown again next time */ } load(); };
  return (
    <div className="stack g12" data-testid="aa2-tracker">
      {d.updates?.length > 0 && (
        <section className="mcard mcard-tight mcard-accent stack g8" aria-labelledby="aa2-upd-h" data-testid="aa2-updates">
          <strong id="aa2-upd-h" className="small">Updates</strong>
          <ul className="stack g4 aa2-list">{d.updates.map((u) => <li key={u.id} className="small aa2-wrap" data-testid="aa2-update" data-status={u.status}>{u.text}</li>)}</ul>
          <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={seen} data-testid="aa2-updates-seen">Got it</button>
        </section>
      )}
      <div className="aa2-stages" role="radiogroup" aria-label="Filter by stage">
        {d.stages.map((s) => (
          <button key={s.key} type="button" role="radio" aria-checked={pick === s.key} className={`aa2-stage aa2-${STAGE_TONE[s.key]} ${pick === s.key ? 'on' : ''}`} onClick={() => setPick(pick === s.key ? null : s.key)} data-testid={`aa2-stage-${s.key}`}>
            <strong>{s.count}</strong><span>{s.label}</span>
          </button>
        ))}
      </div>
      {focused && <div className="aa2-bar"><span className="small muted">The application this reply is about.</span><button type="button" className="link-btn small" onClick={onAll} data-testid="aa2-tracker-all">Show all</button></div>}
      {rows.length === 0 ? <Empty compact title="Nothing here yet">The morning run fills this in. Every channel shows up here.</Empty>
        : <ul className="stack g8 aa2-list">{rows.map((it) => <TrackerRow key={it.id} it={it} onChanged={load} toast={toast} />)}</ul>}
    </div>
  );
}

function EmailPanel({ toast }) {
  const [d, setD] = useState(null);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    http(`${BASE}/email`).then(setD).catch(() => setD(false));
    http(`${BASE}/replies`).then(setRows).catch(() => setRows([]));
  }, []);
  if (d === false) return <Empty compact title="Not available">The email channel can’t be shown right now.</Empty>;
  if (!d) return <Skel cards={2} />;
  const save = async (over) => {
    setBusy(true);
    try { setD(await http(`${BASE}/email`, { method: 'PUT', body: { emailOn: d.emailOn, followUp: d.followUp, ...over } })); toast('Saved'); } catch (x) { toast(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="stack g12" data-testid="aa2-email-tab">
      <section className="mcard stack g12" aria-labelledby="aa2-email-h">
        <h2 id="aa2-email-h" className="mcard-title">Email applications</h2>
        <p className="small muted" style={{ margin: 0 }}>When a company asks for applications by email in its own job post or on its careers page, Nm7 sends one short email for you: your cover note, your tailored resume and your Nm7 profile link. The email says Nm7 Auto Apply sent it for you. Nm7 never guesses an address and never uses job boards.</p>
        {!d.channel.on && <p className="mcard mcard-tight mcard-warn small" role="status" style={{ margin: 0 }} data-testid="aa2-email-off">Email applications are off for now. {d.channel.reason} Email jobs show as Ready, so you can apply yourself with one tap.</p>}
        {d.paused && <p className="mcard mcard-tight mcard-warn small" role="status" style={{ margin: 0 }} data-testid="aa2-email-paused">Your email channel is paused because a company marked an Auto Apply email as unwanted. Nm7 will look into it and turn it back on.</p>}
        <div className="stack g4">
          <span className="label">Your apply address</span>
          <strong className="aa2-wrap" data-testid="aa2-email-address">{d.address}</strong>
          <span className="xs muted">Emails go out from this address, and companies’ replies come back to it. Nm7 shows the replies here and sends them on to your own email.</span>
        </div>
        <label className={`aa2-mode ${d.emailOn ? 'on' : ''}`}>
          <input type="checkbox" checked={d.emailOn} disabled={busy} onChange={(e) => save({ emailOn: e.target.checked })} data-testid="aa2-email-on" />
          <span className="stack g4"><strong className="small">Send email applications for me</strong><span className="xs muted">If you turn this off, email jobs wait as Ready and you apply yourself.</span></span>
        </label>
        <label className={`aa2-mode ${d.followUp ? 'on' : ''}`}>
          <input type="checkbox" checked={d.followUp} disabled={busy} onChange={(e) => save({ followUp: e.target.checked })} data-testid="aa2-email-follow" />
          <span className="stack g4"><strong className="small">One follow-up after 7 days</strong><span className="xs muted">Only if the company hasn’t replied. Never more than one per job.</span></span>
        </label>
        <ul className="xs muted aa2-plain" style={{ margin: 0 }}>
          <li>One email per job, ever. At most {d.perDay} a day (<span data-testid="aa2-email-today">{d.sentToday}</span> today).</li>
          <li>No read receipts, no tracking pixels and no tracked links.</li>
          <li>{d.profileLink ? <>Your profile link: <span className="aa2-wrap">{d.profileLink}</span></> : <>Turn on your share link (<Link to="/me/share">Share</Link>) to include your Nm7 profile.</>}</li>
          {d.testMode && <li data-testid="aa2-email-testmode">While Auto Apply 2.0 is being tested, nothing goes to companies. Test emails go to a test inbox.</li>}
        </ul>
      </section>
      <section className="mcard stack g8" aria-labelledby="aa2-replies-h">
        <h2 id="aa2-replies-h" className="mcard-title">Replies</h2>
        {!rows ? <Skel cards={1} lines={2} /> : rows.length === 0 ? <p className="small muted" style={{ margin: 0 }} data-testid="aa2-replies-empty">No replies yet. When a company answers an email, the reply shows here and the tracker says Replied.</p> : <Replies rows={rows} />}
      </section>
    </div>
  );
}

function Approvals({ toast, onChanged }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(null);
  const load = useCallback(() => http(`${BASE}/approvals`).then(setD).catch(() => setD({ items: [], mode: 'approve' })), []);
  useEffect(() => { load(); }, [load]);
  const act = async (key, url, msg) => {
    setBusy(key);
    try { const r = await http(url, { method: 'POST' }); toast(msg(r)); await load(); onChanged(); } catch (x) { toast(x.message); } finally { setBusy(''); }
  };
  if (!d) return <Skel cards={2} />;
  return (
    <div className="stack g12" data-testid="aa2-approvals">
      <div className="aa2-bar">
        <span className="small muted">{d.mode === 'digest' ? 'This week’s list' : 'This morning’s list'}: {d.items.length} job{d.items.length === 1 ? '' : 's'} ready, each tailored once and checked against your resume.</span>
        {d.items.length > 0 && <button type="button" className="btn btn-signal" disabled={!!busy} onClick={() => act('all', `${BASE}/approve-all`, (r) => `Sent ${r.applied}`)} data-testid="aa2-approve-all">Approve all</button>}
      </div>
      {d.items.length === 0 ? <Empty compact title="Nothing waiting for your Approve">New matches appear here each morning.</Empty> : (
        <ul className="stack g8 aa2-list">
          {d.items.map((it) => (
            <li key={it.id} className="mcard mcard-tight stack g8" data-testid="aa2-approval">
              <div className="aa2-rowtop"><JobHead it={it} /><ChannelTag channel={it.channel} partner={it.partner} /></div>
              {it.reasons.length > 0 && <span className="xs muted aa2-wrap">{it.reasons.join(' · ')}</span>}
              <Parts it={it} />
              <div className="row g8 aa2-actions">
                <button type="button" className="btn btn-signal btn-sm" disabled={!!busy} onClick={() => act(it.id, `${BASE}/approve/${it.id}`, () => 'Sent')} data-testid="aa2-approve">Approve</button>
                <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => act(it.id, `${BASE}/approvals/${it.id}/skip`, () => 'Skipped')}>Skip</button>
                <button type="button" className="link-btn small" aria-expanded={open === it.id} onClick={() => setOpen(open === it.id ? null : it.id)}>{open === it.id ? 'Hide' : 'See what will be sent'}</button>
              </div>
              {open === it.id && <Version v={it.version} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WaitingItem({ it, toast, onDone }) {
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async (e) => {
    e.preventDefault();
    if (it.questions.some((q) => answers[q.id] == null || String(answers[q.id]).trim() === '')) { setErr('Answer every question.'); return; }
    setBusy(true); setErr('');
    try {
      const body = { answers: Object.fromEntries(it.questions.map((q) => [q.id, q.kind === 'number' ? Number(answers[q.id]) : answers[q.id]])) };
      const r = await http(`${BASE}/waiting/${it.id}/answer`, { method: 'POST', body });
      toast(r.state === 'form_queued' ? 'Saved to your profile. Nm7 sends it through the company’s form now.' : r.state === 'applied' || r.state === 'sent' ? 'Saved to your profile and sent' : r.state === 'queued' ? 'Saved. It goes first thing tomorrow (today’s limit is used).' : 'Saved. This job is not a fit for your answers.');
      onDone();
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <li className="mcard mcard-tight stack g8" data-testid="aa2-waiting-item">
      <div className="aa2-rowtop"><JobHead it={it} /><ChannelTag channel={it.channel} partner={it.partner} /></div>
      <form className="stack g8" onSubmit={send}>
        {it.questions.map((q) => (
          <fieldset key={q.id} className="stack g4" style={{ border: 0, margin: 0, padding: 0 }}>
            {q.kind === 'text' ? (
              <div className="field"><label className="label" htmlFor={`w-${it.id}-${q.id}`}>{q.text}</label>
                <input id={`w-${it.id}-${q.id}`} className="input" maxLength={500} value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} data-testid="aa2-answer-text" /></div>
            ) : q.kind === 'number' ? (
              <div className="field"><label className="label" htmlFor={`w-${it.id}-${q.id}`}>{q.text}</label>
                <input id={`w-${it.id}-${q.id}`} className="input" inputMode="numeric" maxLength={6} value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value.replace(/[^\d]/g, '') })} /></div>
            ) : (
              <>
                <legend className="label">{q.text}</legend>
                <div className="row g12" style={{ flexWrap: 'wrap' }}>
                  {(q.kind === 'yesno' ? [['yes', 'Yes'], ['no', 'No']] : q.options.map((o) => [o, o])).map(([v, l]) => (
                    <label key={v} className="row g4 small"><input type="radio" name={`w-${it.id}-${q.id}`} checked={answers[q.id] === v} onChange={() => setAnswers({ ...answers, [q.id]: v })} /> {l}</label>
                  ))}
                </div>
              </>
            )}
          </fieldset>
        ))}
        <span className="xs muted">Your answers are saved to your profile, so Nm7 never asks again. This application is sent as soon as you answer.</span>
        {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
        <button type="submit" className="btn btn-signal btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="aa2-answer">Save and send</button>
      </form>
    </li>
  );
}

function Waiting({ toast, onChanged }) {
  const [d, setD] = useState(null);
  const load = useCallback(() => http(`${BASE}/waiting`).then(setD).catch(() => setD([])), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Skel cards={1} />;
  return d.length === 0 ? <Empty compact title="No questions waiting" testid="aa2-waiting-empty">When a company asks something Nm7 can’t answer from your profile, it waits here.</Empty> : (
    <ul className="stack g8 aa2-list" data-testid="aa2-waiting">{d.map((it) => <WaitingItem key={it.id} it={it} toast={toast} onDone={() => { load(); onChanged(); }} />)}</ul>
  );
}

function Suggested({ toast, onChanged }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => http(`${BASE}/suggested`).then(setD).catch(() => setD([])), []);
  useEffect(() => { load(); }, [load]);
  const act = async (id, what) => {
    setBusy(id);
    try {
      const r = await http(`${BASE}/suggested/${id}/${what}`, { method: 'POST' });
      toast(what === 'dismiss' ? 'Hidden' : r.state === 'needs_answer' ? 'One question first: see Waiting for you' : r.state === 'ready' ? 'Ready: open it from the tracker' : r.state === 'queued' ? 'It goes first thing tomorrow' : 'Sent');
      await load(); onChanged();
    } catch (x) { toast(x.message); } finally { setBusy(''); }
  };
  if (!d) return <Skel cards={1} />;
  return d.length === 0 ? <Empty compact title="No suggestions right now">Jobs that match 55–69 show up here for you to decide.</Empty> : (
    <ul className="stack g8 aa2-list" data-testid="aa2-suggested">
      {d.map((it) => (
        <li key={it.id} className="mcard mcard-tight stack g8" data-testid="aa2-suggestion">
          <div className="aa2-rowtop"><JobHead it={it} /><ChannelTag channel={it.channel} partner={it.partner} /></div>
          {(it.reasons.length > 0 || it.concerns.length > 0) && <span className="xs muted aa2-wrap">{[...it.reasons, ...it.concerns].join(' · ')}</span>}
          <Parts it={it} />
          <div className="row g8 aa2-actions">
            <button type="button" className="btn btn-signal btn-sm" disabled={!!busy} onClick={() => act(it.id, 'apply')} data-testid="aa2-sug-apply">Apply</button>
            <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => act(it.id, 'dismiss')}>Not for me</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

const toForm = (r) => ({ ...r, roles: r.roles.join(', '), cities: r.cities.join(', '), avoid: r.avoid.join(', '), minSalary: r.minSalary ? String(r.minSalary / 100000) : '', noticePeriod: r.noticePeriod || '', dailyLimit: String(r.dailyLimit) });

function Rules({ d, onSaved, toast }) {
  const [f, setF] = useState(() => toForm(d.rules));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (k, v) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const lakh = String(f.minSalary).trim();
      const body = { roles: list(f.roles), cities: list(f.cities), remote: f.remote, experience: f.experience, minSalary: lakh ? Math.round(Number(lakh.replace(/[^\d.]/g, '')) * 100000) : null, noticePeriod: f.noticePeriod || null, jobTypes: f.jobTypes, avoid: list(f.avoid), dailyLimit: Number(f.dailyLimit), mode: f.mode };
      onSaved(await http(`${BASE}/rules`, { method: 'PUT', body })); toast('Rules saved');
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const max = d.limits.maxDailyLimit;
  return (
    <form className="mcard stack g16" onSubmit={save} aria-labelledby="aa2-rules-h" data-testid="aa2-rules">
      <h2 id="aa2-rules-h" className="mcard-title">Your rules</h2>
      <FieldGroup title="What to apply for">
        <div className="field full"><label className="label" htmlFor="aa2-roles">Roles or skills (comma between)</label><input id="aa2-roles" className="input" value={f.roles} onChange={set('roles')} placeholder="Data Analyst, SQL" /></div>
        <fieldset className="stack g8 full" style={{ border: 0, margin: 0, padding: 0 }}><legend className="label">Job types (none = any)</legend>
          <div className="maa-checks">{JOB_TYPES.map((x) => <label key={x}><input type="checkbox" checked={f.jobTypes.includes(x)} onChange={() => toggle('jobTypes', x)} /> {TYPE_LABEL[x] || x}</label>)}</div></fieldset>
        <fieldset className="stack g8 full" style={{ border: 0, margin: 0, padding: 0 }}><legend className="label">Experience (none = any that fits your resume)</legend>
          <div className="maa-checks">{EXPERIENCE.map((x) => <label key={x}><input type="checkbox" checked={f.experience.includes(x)} onChange={() => toggle('experience', x)} /> {EXP_LABEL[x] || x}</label>)}</div></fieldset>
      </FieldGroup>
      <FieldGroup title="Where and pay">
        <div className="field full"><label className="label" htmlFor="aa2-cities">Cities (comma between; empty = anywhere)</label><input id="aa2-cities" className="input" value={f.cities} onChange={set('cities')} placeholder="Hyderabad, Pune" /></div>
        <div className="maa-checks full"><label><input type="checkbox" checked={f.remote} onChange={(e) => setF({ ...f, remote: e.target.checked })} /> Remote jobs too</label></div>
        <div className="field"><label className="label" htmlFor="aa2-salary">Minimum salary (lakh a year)</label><input id="aa2-salary" className="input" inputMode="decimal" value={f.minSalary} onChange={set('minSalary')} placeholder="3" /></div>
        <div className="field"><label className="label" htmlFor="aa2-notice">Notice period</label><select id="aa2-notice" className="input" value={f.noticePeriod} onChange={set('noticePeriod')}>{NOTICE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      </FieldGroup>
      <FieldGroup title="Limits">
        <div className="field full"><label className="label" htmlFor="aa2-avoid">Companies to never apply to (comma between)</label><input id="aa2-avoid" className="input" value={f.avoid} onChange={set('avoid')} /></div>
        <div className="field"><label className="label" htmlFor="aa2-limit">Applications a day (at most {max})</label><input id="aa2-limit" className="input" type="number" min={1} max={max} step={1} value={f.dailyLimit} onChange={set('dailyLimit')} /></div>
      </FieldGroup>
      <fieldset className="stack g8" style={{ border: 0, margin: 0, padding: 0 }} data-testid="aa2-modes">
        <legend className="label">How applications go out</legend>
        {MODES.map(([v, l, help]) => (
          <label key={v} className={`aa2-mode ${f.mode === v ? 'on' : ''}`}>
            <input type="radio" name="aa2-mode" value={v} checked={f.mode === v} onChange={() => setF({ ...f, mode: v })} />
            <span className="stack g4" style={{ minWidth: 0 }}><strong className="small">{l}{v === 'approve' ? ' (recommended)' : ''}</strong><span className="xs muted">{help}</span></span>
          </label>
        ))}
      </fieldset>
      <p className="xs muted" style={{ margin: 0 }}>Match {d.thresholds.auto}+ goes to your list; {d.thresholds.suggest}–{d.thresholds.auto - 1} shows in Suggested; lower is skipped. Nm7 only fills simple forms on a company’s own website (never a CAPTCHA, a sign-in or an account), never asks for your passwords and never uses job boards.</p>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <StickyBar label="Rules"><button type="submit" className="btn btn-signal" disabled={busy} data-testid="aa2-save">Save rules</button></StickyBar>
    </form>
  );
}

function Consent({ d, onSaved, toast }) {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { onSaved(await http(`${BASE}/consent`, { method: 'POST', body: { agree } })); toast('Auto Apply 2.0 is on'); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <section className="mcard mcard-accent stack g12" aria-labelledby="aa2-consent-h" data-testid="aa2-consent">
      <h2 id="aa2-consent-h" className="mcard-title">Turn on Auto Apply 2.0</h2>
      {!d.gate.ok && <p className="small" style={{ margin: 0 }}>Your resume scores {d.gate.score ?? 0}; it needs {d.gate.need}. <Link to="/me/auto-apply">See what to fix</Link></p>}
      {d.rules.roles.length === 0 && <p className="small" style={{ margin: 0 }}>Save your rules first (the Rules tab).</p>}
      <label className="maa-consent"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="aa2-agree" /><span>{d.consent.text}</span></label>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <button type="button" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={busy || !agree} onClick={go} data-testid="aa2-turn-on">Turn on</button>
    </section>
  );
}

export default function AutoApplyV2() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [missing, setMissing] = useState(false);
  const [sp, setSp] = useSearchParams();
  const tab = TABS.some(([k]) => k === sp.get('tab')) ? sp.get('tab') : 'tracker';
  const [stopAsk, setStopAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => http(BASE).then(setD).catch(() => setMissing(true)), []);
  useEffect(() => { load(); }, [load]);
  if (missing) return <Empty title="Not available" testid="aa2-missing" action={<Link to="/me/auto-apply" className="btn btn-outline">Auto Apply</Link>}>This page isn’t open for your account yet.</Empty>;
  if (!d) return <Skel cards={3} />;
  const act = async (url, body, msg) => {
    setBusy(true);
    try { setD(await http(url, { method: 'POST', body })); toast(msg); setStopAsk(false); } catch (x) { toast(x.message); } finally { setBusy(false); }
  };
  const setUp = !!d.consent.at;
  const badge = { replies: d.inboxUnread, ready: d.morning?.count ?? d.counts.ready, approve: d.counts.approvals, waiting: d.counts.waiting, suggested: d.counts.suggested };
  return (
    <div className="stack g16 aa2" data-testid="aa2">
      <MeHead title="Auto Apply 2.0" sub="Nm7 finds jobs that fit your rules, tailors your resume for each (reorder and rephrase only) and applies the way you choose." />
      {!d.public && <p className="xs muted" style={{ margin: 0 }} data-testid="aa2-preview">Preview: only testers see this page for now.</p>}
      {!d.siteOn && <p className="mcard mcard-tight mcard-warn" role="status" style={{ margin: 0 }}>Auto Apply is paused for everyone right now. Nothing is being sent.</p>}
      {setUp ? (
        <section className="mcard mcard-tight aa2-status" aria-label="Status" data-testid="aa2-status">
          <span className="stack g4" style={{ minWidth: 0 }}>
            <strong data-testid="aa2-state">{d.on ? 'Auto Apply 2.0 is on' : 'Auto Apply 2.0 is paused'}</strong>
            <span className="xs muted">{MODES.find(([m]) => m === d.rules.mode)?.[1]} · today {d.today.used} of {d.today.limit}</span>
          </span>
          <span className="row g8 aa2-actions">
            <button type="button" className={`btn ${d.on ? 'btn-outline' : 'btn-signal'} btn-sm`} disabled={busy} onClick={() => act(`${BASE}/pause`, { paused: d.on }, d.on ? 'Paused' : 'Resumed')} data-testid="aa2-pause">{d.on ? 'Pause' : 'Resume'}</button>
            {!stopAsk && <button type="button" className="link-btn small" onClick={() => setStopAsk(true)}>Stop and withdraw consent</button>}
          </span>
          {stopAsk && (
            <div className="row g8 well aa2-wrap" role="alert" style={{ flexWrap: 'wrap', width: '100%' }}>
              <span className="small">Nothing more will be prepared or sent. Jobs waiting for you are withdrawn; what was already sent stays in the tracker.</span>
              <button type="button" className="btn btn-signal btn-sm" disabled={busy} onClick={() => act(`${BASE}/stop`, undefined, 'Stopped')} data-testid="aa2-stop">Stop</button>
              <button type="button" className="link-btn small" onClick={() => setStopAsk(false)}>Cancel</button>
            </div>
          )}
        </section>
      ) : <Consent d={d} onSaved={setD} toast={toast} />}
      {d.morning && !d.morning.seen && d.morning.count > 0 && tab !== 'ready' && (
        <section className="mcard mcard-tight mcard-accent aa2-bar" aria-label="This morning" data-testid="aa2-morning">
          <span className="small"><strong>{d.morning.count} job{d.morning.count === 1 ? '' : 's'} ready</strong> for you to apply to yourself, each with its kit.</span>
          <button type="button" className="btn btn-signal btn-sm" onClick={() => setSp({ tab: 'ready' }, { replace: true })} data-testid="aa2-morning-open">See them</button>
        </section>
      )}
      {d.learning.length > 0 && <p className="xs muted" style={{ margin: 0 }} data-testid="aa2-learning">{d.learning.map((x) => x.text).join(' ')}</p>}
      <nav className="aa2-tabs" aria-label="Auto Apply 2.0">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" className={`aa2-tab ${tab === k ? 'on' : ''}`} aria-current={tab === k ? 'page' : undefined} onClick={() => setSp({ tab: k }, { replace: true })} data-testid={`aa2-tab-${k}`}>
            {l}{badge[k] ? <span className="aa2-badge">{badge[k]}</span> : null}
          </button>
        ))}
      </nav>
      {d.pricing?.on && <p className="xs muted" style={{ margin: 0 }} data-testid="aa2-pricing">{d.pricing.weekLimit == null ? 'No weekly limit on your plan.' : `This week: ${d.pricing.usedThisWeek} of ${d.pricing.weekLimit} ${d.pricing.plan === 'paid' ? '' : 'free '}applications used.`}</p>}
      {tab === 'tracker' && <Tracker toast={toast} focus={sp.get('item')} onAll={() => setSp({ tab: 'tracker' }, { replace: true })} />}
      {tab === 'replies' && <Inbox toast={toast} onOpen={(id) => setSp({ tab: 'tracker', item: id }, { replace: true })} onChanged={load} />}
      {tab === 'week' && <Week onTab={(k) => setSp({ tab: k }, { replace: true })} />}
      {tab === 'ready' && <OneTap toast={toast} onChanged={load} />}
      {tab === 'approve' && <Approvals toast={toast} onChanged={load} />}
      {tab === 'waiting' && <Waiting toast={toast} onChanged={load} />}
      {tab === 'suggested' && <Suggested toast={toast} onChanged={load} />}
      {tab === 'email' && <EmailPanel toast={toast} />}
      {tab === 'rules' && <Rules d={d} onSaved={setD} toast={toast} />}
    </div>
  );
}
