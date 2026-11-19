// Profile & settings: account details (career details live in the Job Profile), notifications per channel, privacy (download data, delete account).
// Also Help & referral.
import { useVettingOn } from '../../lib/vettingAccess';
import { langsShown } from '../../lib/i18n';
import MyStories from './MyStories';
import DeleteAccount from './DeleteAccount';
import { Suspense, lazy, useEffect, useState } from 'react';
import { useTrustOn } from '../../lib/trustAccess';
import { Link } from 'react-router-dom';
import { Dialog, Spinner, useToast } from '../../components/ui';
import { useMe, setMe, getMe, resetMe, saveProfile, raiseIssue } from '../../lib/customerStore';
import { LIVE, changePassword, passwordIssue, useAuth } from '../../lib/auth';
import { useExpertOrders } from '../../lib/expertStore';
import { savePdf } from '../builder/resumePdf';
import { PROMISES } from '../../lib/pricing';
import { getJobProfile } from '../../lib/profileStore';
import { canSave, deleteLinkedIn, getLinkedIn } from '../../lib/linkedin/api';
import { deleteJobData } from '../../lib/jobs';
import { MeHead } from './MeLayout';
import { http } from '../../services/http';
import { fmtDay } from './shared';
import { Bar, Chip, FieldGroup, MeCard, StickyBar } from './kit';
import '../../styles/me-account.css';

const GoogleCard = lazy(() => import('./GoogleCard')); // Sign in with Google: connect / remove (live only)

/** Resume health alert emails (at most one every two weeks); the same switch as the email's "Stop these emails". */
function HealthEmails() {
  const [on, setOn] = useState(null);
  useEffect(() => { if (LIVE) http('/api/me/health').then((d) => setOn(d.emails), () => {}); }, []);
  if (on === null) return null;
  const set = async (v) => { setOn(v); try { setOn((await http('/api/me/health/emails', { method: 'PUT', body: { on: v } })).emails); } catch { setOn(!v); } };
  return (
    <label className="acc-switch small">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} data-testid="health-emails" />
      <span><strong>Resume health emails</strong> — small fixes for your resume, at most once every two weeks.</span>
    </label>
  );
}

/** Profile setup P2: the weekly reminder about the next checklist step (at most once a week, none once complete). */
function SetupReminders() {
  const [on, setOn] = useState(null);
  useEffect(() => { if (LIVE) http('/api/me/checklist/reminders').then((d) => setOn(d.on), () => {}); }, []);
  if (on === null) return null;
  const set = async (v) => { setOn(v); try { setOn((await http('/api/me/checklist/reminders', { method: 'PUT', body: { on: v } })).on); } catch { setOn(!v); } };
  return (
    <label className="acc-switch small">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} data-testid="setup-reminders" />
      <span><strong>Profile setup reminders</strong> — your next step, at most once a week, until your profile is complete.</span>
    </label>
  );
}

const PrivacyConsent = lazy(() => import('./trust/PrivacyConsent')); // Vetting Trust T1, only when the switch says yes
const DigiLockerCard = lazy(() => import('./trust/DigiLockerCard')); // Vetting Trust T2: Verify with DigiLocker
const FaceCard = lazy(() => import('./trust/FaceCard')); // Vetting Trust T3: ID + selfie check
const NeverPayHelp = lazy(() => import('./trust/HireSafety').then((m) => ({ default: m.NeverPayHelp }))); // Vetting Trust T4

const LEVELS = [['internship', 'Internship'], ['fresher', 'Fresher'], ['0_1', '0–1 years'], ['1_3', '1–3 years'], ['3_5', '3–5 years'], ['5_8', '5–8 years'], ['8_12', '8–12 years'], ['12_15', '12–15 years'], ['15_plus', '15+ years']];
const ALL_LANGS = [['en', 'English'], ['te', 'తెలుగు (Telugu)'], ['hi', 'हिन्दी (Hindi)']];
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** Job alerts (C6): new jobs that match, by email, daily or weekly, in English, Telugu or Hindi. */
function JobAlerts() {
  const toast = useToast();
  const [a, setA] = useState(null);
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (LIVE) http('/api/me/job-alerts').then((d) => { setA(d); setF({ ...d, roles: d.roles.join(', '), cities: d.cities.join(', ') }); }, () => {}); }, []);
  if (!f) return null;
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const d = await http('/api/me/job-alerts', { method: 'PUT', body: { ...f, roles: list(f.roles), cities: list(f.cities) } });
      setA(d); setF({ ...d, roles: d.roles.join(', '), cities: d.cities.join(', ') }); toast(d.on ? 'Job alerts saved' : 'Job alerts are off');
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const lvl = (k) => setF({ ...f, experience: f.experience.includes(k) ? f.experience.filter((x) => x !== k) : [...f.experience, k] });
  return (
    <form id="job-alerts" className="mcard acc-sec" aria-label="Job alerts" onSubmit={save} data-testid="job-alerts">
      <header className="mcard-h"><span className="mcard-ic teal" aria-hidden="true">✦</span><span className="mcard-ht"><h2 className="mcard-title">Job alerts</h2><span className="mcard-sub">New jobs on Nm7 that match, by email with a WhatsApp share link for each. Only when there are new matches; at most one email a day.</span></span>{a?.on && <span className="mcard-actions"><span className="xs muted acc-on" data-testid="alerts-status">On · {a.frequency === 'daily' ? 'daily' : 'weekly'}</span></span>}</header>
      <label className="acc-switch small"><input type="checkbox" checked={f.on} onChange={(e) => setF({ ...f, on: e.target.checked })} data-testid="alerts-on" /> Send me job alerts</label>
      <FieldGroup title="What and where">
        <div className="field"><label className="label" htmlFor="al-roles">Roles or skills (comma between, up to 5)</label><input id="al-roles" className="input" placeholder="Data analyst, SQL" value={f.roles} onChange={(e) => setF({ ...f, roles: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="al-cities">Cities (comma between; empty = anywhere)</label><input id="al-cities" className="input" placeholder="Hyderabad, Pune" value={f.cities} onChange={(e) => setF({ ...f, cities: e.target.value })} /></div>
        <label className="acc-switch small full"><input type="checkbox" checked={f.remote} onChange={(e) => setF({ ...f, remote: e.target.checked })} /> Include remote jobs</label>
      </FieldGroup>
      <fieldset className="mfields">
        <legend className="mfields-h">Experience</legend>
        <p className="mfields-help">None ticked = any.</p>
        <div className="acc-pills">{LEVELS.map(([k, l]) => <label key={k} className="acc-pill small"><input type="checkbox" checked={f.experience.includes(k)} onChange={() => lvl(k)} /> {l}</label>)}</div>
      </fieldset>
      <fieldset className="mfields">
        <legend className="mfields-h">How often</legend>
        <div className="acc-pills">{[['daily', 'Daily'], ['weekly', 'Weekly']].map(([k, l]) => <label key={k} className="acc-pill small"><input type="radio" name="al-freq" checked={f.frequency === k} onChange={() => setF({ ...f, frequency: k })} /> {l}</label>)}</div>
        <div className="field" style={{ maxWidth: 280 }}><label className="label" htmlFor="al-lang">Email language</label><select id="al-lang" className="input" value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })}>{(langsShown() ? ALL_LANGS : ALL_LANGS.slice(0, 1)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      </fieldset>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="mrow"><button type="submit" className="btn btn-signal" disabled={busy}>{busy ? 'Saving…' : 'Save job alerts'}</button></div>
    </form>
  );
}

const EVENTS = [['order', 'Order updates'], ['draft', 'Drafts ready to review'], ['jobs', 'Matched jobs'], ['tips', 'Tips & offers']];
const CHANNELS = [['whatsapp', 'WhatsApp'], ['email', 'Email'], ['sms', 'SMS']];
const PHONE_RE = /^(\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Data rules in plain words (Vetting V5 / DPDP); the server's scheduled cleanup does the deleting. */
const KEEP = [
  ['Audio', 'never stored. Speech is turned into text in your browser.'],
  ['Photos of your work', '30 days.'],
  ['Interview transcripts', '180 days.'],
  ['Raw IP addresses', '30 days.'],
  ['Skill check answers', 'until you delete your account.'],
];

export function MeSettings() {
  const me = useMe();
  const all = useExpertOrders();
  const vet = useVettingOn(); // Vetting V5 additions only for people who get the engine (Admin → Skill checks → Launch)
  const trust = useTrustOn(); // Vetting Trust T1: Privacy & consent (Admin → Skill checks → Vetting Trust)
  const toast = useToast();
  const [f, setF] = useState(me.account);
  const [del, setDel] = useState(false);
  const [liDel, setLiDel] = useState(false);
  const [jobDel, setJobDel] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false); // show field errors once Save was pressed
  const errs = { name: !f.name.trim() && 'Enter your name', email: !EMAIL_RE.test(f.email) && 'Enter a valid email', phone: f.phone && !PHONE_RE.test(f.phone.trim()) && 'Enter a 10-digit Indian mobile number' };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault(); setTried(true);
    if (errs.name || errs.phone) { document.getElementById(errs.name ? 'p-n' : 'p-p')?.focus(); return; }
    if (busy) return;
    setBusy(true); setError('');
    try { await saveProfile({ ...f, email: me.account.email }); toast('Saved'); } catch (err) { setError(err.message || 'Not saved. Please try again.'); } finally { setBusy(false); }
  };
  const exportAll = async () => {
    if (LIVE && vet) { // the live build: everything the server holds about you (DPDP), as one JSON file
      try {
        const data = await http('/api/me/data-export');
        await savePdf(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'my-nm7-data.json');
        toast('Your data file is ready');
      } catch (err) { toast(err.message || 'Couldn’t make your data file. Please try again.'); }
      return;
    }
    const s = getMe();
    const data = { exportedAt: new Date().toISOString(), account: s.account, orders: s.orders, expertOrders: all.filter((x) => s.orders.some((o) => o.id === x.id)).map(({ id, status, versions, messages, comments }) => ({ id, status, versions, messages, comments })), resumes: s.resumes, coverLetters: s.covers, applications: s.apps, atsChecks: s.checks, shareLink: s.share, issues: s.issues, jobProfile: getJobProfile().data, linkedin: canSave() ? await getLinkedIn().catch(() => null) : null };
    await savePdf(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'my-nm7-data.json');
    toast('Your data file is ready');
  };
  const notify = (ch, ev, v) => setMe((s) => ({ account: { ...s.account, notify: { ...s.account.notify, [ch]: { ...s.account.notify[ch], [ev]: v } } } }));

  return (
    <>
      <MeHead title="Profile & settings" sub="Your account, how we reach you, and your data." />
      <nav className="acc-jump" aria-label="On this page">
        {[['#s-profile', 'Profile'], ['#s-notify', 'Notifications'], ...(LIVE ? [['#job-alerts', 'Job alerts']] : []), ['#s-password', 'Password'], ['#s-privacy', 'Privacy'], ...(trust ? [['#s-consent', 'Consent'], ['#s-work', 'Work preferences'], ['#s-criteria', 'Job requirements'], ['#s-calls', 'Calls & WhatsApp'], ['#s-docs', 'Documents'], ['#s-face', 'ID + selfie']] : [])].map(([h, l]) => <a key={h} href={h} className="acc-jump-a">{l}</a>)}
      </nav>
      <form id="s-profile" className="mcard acc-sec" onSubmit={save} aria-label="Profile" noValidate>
        <header className="mcard-h"><span className="mavatar" aria-hidden="true">{(me.account.name || '?').trim()[0]?.toUpperCase()}</span><span className="mcard-ht"><h2 className="mcard-title">Profile</h2><span className="mcard-sub">Your name and mobile number. Career details live in your Job Profile.</span></span></header>
        <FieldGroup>
          <div className="field"><label htmlFor="p-n" className="label">Full name</label><input id="p-n" className="input" value={f.name} onChange={set('name')} aria-invalid={tried && errs.name ? 'true' : undefined} aria-describedby={tried && errs.name ? 'p-n-err' : undefined} />{tried && errs.name && <span id="p-n-err" role="alert" className="error">{errs.name}</span>}</div>
          <div className="field"><label htmlFor="p-p" className="label">Mobile (WhatsApp)</label><input id="p-p" className="input" value={f.phone} onChange={set('phone')} aria-invalid={!!errs.phone} aria-describedby={errs.phone ? 'p-p-err' : undefined} />{errs.phone && <span id="p-p-err" className="error">{errs.phone}</span>}</div>
          <div className="field full"><label htmlFor="p-e" className="label">Email</label><input id="p-e" type="email" className="input" style={{ background: 'var(--sunken)', color: 'var(--text2)', cursor: 'not-allowed' }} value={me.account.email} readOnly aria-readonly="true" aria-describedby="p-e-h" /><span id="p-e-h" className="xs faint">This is your sign-in email. To change it, write to info@nm7.si from this address.</span></div>
        </FieldGroup>
        {error && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</span>}
        <Link to="/me/profile" className="btn btn-outline acc-jp">Target role, cities &amp; career details → Job Profile</Link>
        <StickyBar label="Profile actions"><button type="submit" className="btn btn-signal" disabled={busy}>{busy ? <Spinner /> : 'Save'}</button></StickyBar>
      </form>

      <MeCard as="section" id="s-notify" className="acc-sec" label="Notifications" icon="🔔" title="Notifications" sub="Choose how we tell you about each thing.">
        <div className="table-wrap mtable-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table mtable acc-notify"><thead><tr><th>Event</th>{CHANNELS.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
          <tbody>{EVENTS.map(([ev, l]) => <tr key={ev}><th scope="row" className="small acc-ev">{l}</th>{CHANNELS.map(([ch, cl]) => <td key={ch} data-label={cl}><input type="checkbox" className="acc-cb" aria-label={`${l} on ${cl}`} checked={!!me.account.notify[ch][ev]} disabled={ev === 'order' && ch === 'email'} onChange={(e) => notify(ch, ev, e.target.checked)} /></td>)}</tr>)}</tbody></table></div>
        <span className="xs faint">Order emails stay on — they carry your receipts and refund updates.</span>
        <HealthEmails />
        <SetupReminders />
      </MeCard>

      <JobAlerts />

      {LIVE && <Suspense fallback={null}><GoogleCard /></Suspense>}

      <ChangePassword />

      <MeCard as="section" id="s-privacy" className="acc-sec" label="Privacy" icon="🔒" title="Privacy" sub={`Expert files are kept for ${PROMISES.retentionDays} days after delivery. Your own resumes stay until you delete them.`}>
        <ul className="mlist">
          <li className="mitem"><span className="mitem-main"><span className="mitem-title">Your data</span><span className="mitem-meta">Download everything we hold about you — resumes, orders, messages, applications.</span></span><span className="mitem-side"><button type="button" className="btn btn-outline" onClick={exportAll}>Download my data</button></span></li>
          {canSave() && <li className="mitem"><span className="mitem-main"><span className="mitem-title">LinkedIn data</span><span className="mitem-meta">Your LinkedIn link, the text from your LinkedIn PDF or pasted sections, and your checks. Kept on your account only, never shared with organizations.</span></span><span className="mitem-side"><button type="button" className="btn btn-outline" onClick={() => setLiDel(true)}>Delete my LinkedIn data</button></span></li>}
          {canSave() && <li className="mitem"><span className="mitem-main"><span className="mitem-title">Job-search data</span><span className="mitem-meta">Job posts you matched, their scores, tailoring suggestions, cover letters and interview prep. Kept on your account only, never shared with organizations.</span></span><span className="mitem-side"><button type="button" className="btn btn-outline" onClick={() => setJobDel(true)}>Delete my job-search data</button></span></li>}
        </ul>
        {vet && <div className="stack g8" data-testid="retention">
          <h3 className="acc-keep-h">How long we keep things</h3>
          <ul className="acc-keep small">
            {KEEP.map(([what, how]) => <li key={what}><strong>{what}:</strong> {how}</li>)}
          </ul>
        </div>}
      </MeCard>
      {trust && <Suspense fallback={null}><PrivacyConsent /></Suspense>}
      {trust && <Suspense fallback={null}><DigiLockerCard /></Suspense>}
      {trust && <Suspense fallback={null}><FaceCard /></Suspense>}
      <MeCard as="section" tone="bad" className="acc-danger" label="Delete account" icon="⚠" title="Delete account" sub="Removes your account and everything in it. Invoices are kept as the law requires.">
        {LIVE ? <DeleteAccount /> : <div className="mspread"><span className="small" style={{ color: 'var(--danger)' }}>Delete my account and all my data.</span><button type="button" className="btn btn-outline acc-danger-btn" onClick={() => setDel(true)}>Delete account</button></div>}
      </MeCard>
      {jobDel && (
        <Dialog showTitle title="Delete your job-search data?" onClose={() => setJobDel(false)}>
          <div className="stack g12">
            <p className="small muted" style={{ margin: 0 }}>This deletes every job post you matched, the scores, tailoring suggestions, cover letters and interview prep. Tailored resume copies stay in My resumes until you delete them there. This can’t be undone.</p>
            <div className="row g8">
              <button type="button" className="btn btn-ink" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
                onClick={async () => { try { await deleteJobData(); setJobDel(false); toast('Your job-search data is deleted.'); } catch (err) { toast(err.message || 'Not deleted. Please try again.'); } }}>Delete job-search data</button>
              <button type="button" className="btn btn-outline" onClick={() => setJobDel(false)}>Keep it</button>
            </div>
          </div>
        </Dialog>
      )}
      {liDel && (
        <Dialog showTitle title="Delete your LinkedIn data?" onClose={() => setLiDel(false)}>
          <div className="stack g12">
            <span className="small muted">This removes your saved LinkedIn link, the PDF text or pasted sections, and your checks and headlines. Your LinkedIn account itself is not touched.</span>
            <button type="button" className="btn btn-ink" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
              onClick={async () => { try { await deleteLinkedIn(); setLiDel(false); toast('Your LinkedIn data is deleted.'); } catch (err) { toast(err.message || 'Not deleted. Please try again.'); } }}>Delete LinkedIn data</button>
          </div>
        </Dialog>
      )}
      {del && (
        <Dialog showTitle title="Delete your account?" onClose={() => setDel(false)}>
          <form className="stack g12" onSubmit={async (e) => {
            e.preventDefault();
            resetMe(); setDel(false); setConfirm(''); toast('Preview: sample data reset. On the live site you confirm with an email code and have 7 days to undo.');
          }}>
            <span className="small muted">This deletes your resumes, cover letters, applications, messages, and your LinkedIn link, PDF text and checks (those go at once). Invoices are kept as the law requires. Download your data first if you want a copy.</span>
            <label htmlFor="del" className="label">Type DELETE to confirm</label>
            <input id="del" className="input" style={{ height: 42 }} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button type="submit" className="btn btn-ink" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} disabled={confirm !== 'DELETE'}>Delete my account</button>
          </form>
        </Dialog>
      )}
    </>
  );
}

/** Current password + new password twice. Signs out every other browser. */
function ChangePassword() {
  const { user } = useAuth();
  if (LIVE && user && user.hasPassword === false) return <SetPassword email={user.email} />;
  return <ChangePasswordForm />;
}
/** An account made with Google has no password yet: Forgot password's emailed code sets one. */
function SetPassword({ email }) {
  return (
    <MeCard as="section" id="s-password" className="acc-sec" label="Password" icon="🔑" title="Set a password" sub="You sign in with Google. Set a password to also sign in with your email.">
      <Link to={`/forgot-password?set=1&email=${encodeURIComponent(email || '')}`} className="btn btn-outline" style={{ alignSelf: 'flex-start' }}>Set a password</Link>
    </MeCard>
  );
}
function ChangePasswordForm() {
  const toast = useToast();
  const [p, setP] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const issue = p.next && passwordIssue(p.next);
  const mismatch = p.again && p.next !== p.again;
  const set = (k) => (e) => setP({ ...p, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (busy || !p.current || issue || mismatch || !p.next) return;
    setBusy(true); setError('');
    try {
      await changePassword(p.current, p.next, p.again);
      setP({ current: '', next: '', again: '' });
      toast('Password changed — other devices are signed out');
    } catch (err) { setError(err.message || 'Not changed. Please try again.'); } finally { setBusy(false); }
  };
  return (
    <form id="s-password" className="mcard acc-sec" onSubmit={submit} aria-label="Change password" noValidate>
      <header className="mcard-h"><span className="mcard-ic violet" aria-hidden="true">🔑</span><span className="mcard-ht"><h2 className="mcard-title">Change password</h2><span className="mcard-sub">Changing it signs you out on every other device.</span></span></header>
      <FieldGroup>
        <div className="field full"><label htmlFor="pw-c" className="label">Current password</label><input id="pw-c" type="password" autoComplete="current-password" className="input" value={p.current} onChange={set('current')} /></div>
        <div className="field"><label htmlFor="pw-n" className="label">New password</label><input id="pw-n" type="password" autoComplete="new-password" className="input" value={p.next} onChange={set('next')} aria-invalid={!!issue} aria-describedby="pw-n-h" /><span id="pw-n-h" className="xs" style={{ color: issue ? 'var(--danger)' : 'var(--text3)' }}>{issue || 'At least 8 characters, with letters and a number.'}</span></div>
        <div className="field"><label htmlFor="pw-a" className="label">Re-type new password</label><input id="pw-a" type="password" autoComplete="new-password" className="input" value={p.again} onChange={set('again')} aria-invalid={!!mismatch} />{mismatch && <span className="xs" style={{ color: 'var(--danger)' }}>The two passwords don’t match.</span>}</div>
      </FieldGroup>
      {error && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</span>}
      <button type="submit" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={busy || !p.current || !p.next || !!issue || p.next !== p.again}>{busy ? <Spinner /> : 'Change password'}</button>
    </form>
  );
}

const FAQ = [
  ['When will I get my first draft?', `Within ${PROMISES.delivery} of finishing the intake questions. The countdown is on your order page.`],
  ['What if it’s late?', `A full refund starts automatically if the first draft misses the ${PROMISES.delivery} promise. It reaches you in ${PROMISES.refundDays}.`],
  ['I don’t like the draft. What now?', 'Leave comments on each section and press “Ask for changes”. If the final still isn’t right, ask for a free re-do from your order page; if that doesn’t fix it, ask for a refund and our team reviews it within 24 hours.'],
  ['How long are my files kept?', `Files from your expert are kept for ${PROMISES.retentionDays} days after delivery. Copies in “My resumes” stay until you delete them.`],
  ['Can I edit the final resume myself?', 'Yes. The final is saved in “My resumes” and opens in the builder like any other resume.'],
  ['Is my phone number shown on my share link?', 'Only if you want — turn on “Hide my phone number” on the Share link page.'],
];

export function MeHelp() {
  const me = useMe();
  const toast = useToast();
  const [t, setT] = useState({ topic: 'Order', order: me.orders[0]?.id || '', text: '' });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const link = `nm7.si/?ref=${me.account.referralCode}`;
  const trust = useTrustOn();
  return (
    <>
      <MeHead title="Help & referral" sub="Answers, support, and a link to share with friends." />
      <div className="mgrid-2">
        <div className="mstack">
          {trust && <Suspense fallback={null}><NeverPayHelp /></Suspense>}
          <MeCard as="section" label="Questions" icon="?" title="Common questions" sub="Tap a question to see the answer.">
            <div className="acc-faq">{FAQ.map(([q, a]) => <details key={q} className="acc-faq-i"><summary>{q}</summary><p className="small muted">{a}</p></details>)}</div>
          </MeCard>
          <form className="mcard" aria-label="Raise an issue" onSubmit={async (e) => {
            e.preventDefault();
            if (sending || t.text.trim().length < 10) return;
            setSending(true); setSendError('');
            try { await raiseIssue({ topic: t.topic, order: t.order || null, text: t.text.trim() }); setT({ ...t, text: '' }); toast('Sent — our team replies by email within 24 hours'); } catch (err) { setSendError(err.message || 'Not sent. Please try again.'); } finally { setSending(false); }
          }}>
            <header className="mcard-h"><span className="mcard-ic violet" aria-hidden="true">✉</span><span className="mcard-ht"><h2 className="mcard-title">Raise an issue</h2><span className="mcard-sub">Our team replies by email within 24 hours.</span></span></header>
            <FieldGroup>
              <div className="field"><label htmlFor="is-t" className="label">About</label><select id="is-t" className="input" value={t.topic} onChange={(e) => setT({ ...t, topic: e.target.value })}>{['Order', 'Payment', 'Refund', 'Expert', 'Builder', 'Account', 'Other'].map((x) => <option key={x}>{x}</option>)}</select></div>
              <div className="field"><label htmlFor="is-o" className="label">Order</label><select id="is-o" className="input" value={t.order} onChange={(e) => setT({ ...t, order: e.target.value })}><option value="">None</option>{me.orders.map((o) => <option key={o.id}>{o.id}</option>)}</select></div>
              <div className="field full"><label htmlFor="is-x" className="label">What happened?</label><textarea id="is-x" className="input" rows={4} value={t.text} onChange={(e) => setT({ ...t, text: e.target.value })} aria-describedby="is-x-h" /><span id="is-x-h" className="xs faint">At least 10 letters. Add your order number if it’s about an order.</span></div>
            </FieldGroup>
            {sendError && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{sendError}</span>}
            <button type="submit" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={sending || t.text.trim().length < 10}>{sending ? <Spinner /> : 'Send to support'}</button>
            {me.issues.length > 0 && (
              <ul className="mlist" aria-label="Your issues">
                {me.issues.map((i) => (
                  <li key={i.id} className="mitem acc-issue">
                    <span className="mitem-main">
                      <span className="mspread"><strong className="small">{i.id} · {i.topic}{i.order ? ` · ${i.order}` : ''}</strong><Chip tone={i.status === 'resolved' ? 'ok' : 'warn'}>{i.status === 'resolved' ? 'Resolved' : 'Open'}</Chip></span>
                      <span className="small">{i.text}</span>
                      {i.reply && <span className="small muted"><strong>Support:</strong> {i.reply}</span>}
                      <span className="xs faint">{fmtDay(i.at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </form>
        </div>
        <div className="mstack">
          <section className="mcard mcard-accent acc-ref" aria-label="Refer a friend">
            <header className="mcard-h"><span className="mcard-ic" aria-hidden="true">♥</span><span className="mcard-ht"><h2 className="mcard-title">Refer a friend</h2><span className="mcard-sub">Share your link. Friends get a resume that works.</span></span></header>
            <ReferralProgress reward={me.referralReward} />
            <div className="acc-reflink"><span className="mono small" style={{ overflowWrap: 'anywhere' }} data-testid="ref-link">{link}</span><button type="button" className="btn btn-outline" onClick={async () => { try { await navigator.clipboard.writeText(`https://${link}`); toast('Link copied'); } catch { toast(`Copy this: https://${link}`); } }}>Copy</button></div>
            <a className="btn btn-signal" style={{ alignSelf: 'flex-start' }} href={`https://wa.me/?text=${encodeURIComponent(`I fixed my resume on Nm7 — try it: https://${link}`)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
            <div className="mgrid-3 acc-ref-stats">
              <div className="mstat"><span className="mstat-l">Friends joined</span><strong className="mstat-v">{me.referrals.length}</strong></div>
              <div className="mstat"><span className="mstat-l">Bought a plan</span><strong className="mstat-v">{me.referrals.filter((r) => r.status === 'bought').length}</strong></div>
            </div>
            {me.referrals.length > 0 && <ul className="mlist acc-friends">{me.referrals.map((r) => <li key={r.name + r.at} className="xs muted" data-testid="ref-friend">{r.name} · {r.status === 'bought' ? 'bought a plan' : 'joined'} · {fmtDay(r.at)}{me.referralReward?.on ? ` · ${r.counts ? 'counts' : WHY[r.why] || 'doesn’t count yet'}` : ''}</li>)}</ul>}
          </section>
          <MyStories name={me.account.name} />
        </div>
      </div>
    </>
  );
}

const WHY = { email_not_confirmed: 'hasn’t confirmed their email yet', no_resume: 'hasn’t built a resume with their name yet', not_eligible: 'doesn’t count' };

/** "2 of 3 friends" towards free downloads (the same unlock as paying for the resume plan). */
function ReferralProgress({ reward }) {
  if (!reward?.on && !reward?.unlocked) return <span className="small muted">Share your link with friends who need a resume.</span>;
  if (reward.unlocked) return <span className="small" data-testid="ref-reward" style={{ color: 'var(--success)' }}><strong>Downloads unlocked.</strong> Thanks for inviting your friends — PDF and Word downloads are free for you now.</span>;
  if (reward.revoked) return <span className="small muted" data-testid="ref-reward">Your referral reward was removed. Write to support if you think this is a mistake.</span>;
  return (
    <div className="stack g4" data-testid="ref-reward">
      <span className="small">Invite {reward.needed} friends: when they sign up, confirm their email and build a resume with their name, your downloads unlock free.</span>
      <span className="small"><strong>{reward.counted} of {reward.needed}</strong> friends done</span>
      <Bar value={reward.counted} max={reward.needed} label="Friends who count" tone="ok" showValue={false} />
      <span className="xs faint">One reward per account. Sign-ups from your own phone or Wi-Fi, or with throwaway email addresses, don’t count.</span>
    </div>
  );
}
