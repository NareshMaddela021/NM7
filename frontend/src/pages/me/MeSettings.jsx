// Profile & settings: account details (career details live in the Job Profile), notifications per channel, privacy (download data, delete account).
// Also Help & referral.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, Spinner, useToast } from '../../components/ui';
import { useMe, setMe, getMe, resetMe, saveProfile, raiseIssue } from '../../lib/customerStore';
import { LIVE, changePassword, passwordIssue } from '../../lib/auth';
import { useExpertOrders } from '../../lib/expertStore';
import { savePdf } from '../builder/resumePdf';
import { PROMISES, REFERRAL, inr } from '../../lib/pricing';
import { getJobProfile } from '../../lib/profileStore';
import { canSave, deleteLinkedIn, getLinkedIn } from '../../lib/linkedin/api';
import { deleteJobData } from '../../lib/jobs';
import { MeHead } from './MeLayout';
import { fmtDay } from './shared';

const EVENTS = [['order', 'Order updates'], ['draft', 'Drafts ready to review'], ['jobs', 'Matched jobs'], ['tips', 'Tips & offers']];
const CHANNELS = [['whatsapp', 'WhatsApp'], ['email', 'Email'], ['sms', 'SMS']];
const PHONE_RE = /^(\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function MeSettings() {
  const me = useMe();
  const all = useExpertOrders();
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
    const s = getMe();
    const data = { exportedAt: new Date().toISOString(), account: s.account, orders: s.orders, expertOrders: all.filter((x) => s.orders.some((o) => o.id === x.id)).map(({ id, status, versions, messages, comments }) => ({ id, status, versions, messages, comments })), resumes: s.resumes, coverLetters: s.covers, applications: s.apps, atsChecks: s.checks, shareLink: s.share, issues: s.issues, jobProfile: getJobProfile().data, linkedin: canSave() ? await getLinkedIn().catch(() => null) : null };
    await savePdf(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'my-asuraa-data.json');
    toast('Your data file is ready');
  };
  const notify = (ch, ev, v) => setMe((s) => ({ account: { ...s.account, notify: { ...s.account.notify, [ch]: { ...s.account.notify[ch], [ev]: v } } } }));

  return (
    <>
      <MeHead title="Profile & settings" />
      <form className="card stack g12" onSubmit={save} aria-label="Profile" noValidate>
        <strong>Profile</strong>
        <div className="row g12">
          <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="p-n" className="label">Full name</label><input id="p-n" className="input" style={{ height: 42 }} value={f.name} onChange={set('name')} aria-invalid={tried && errs.name ? 'true' : undefined} aria-describedby={tried && errs.name ? 'p-n-err' : undefined} />{tried && errs.name && <span id="p-n-err" role="alert" className="error">{errs.name}</span>}</div>
          <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="p-e" className="label">Email</label><input id="p-e" type="email" className="input" style={{ height: 42, background: 'var(--sunken)', color: 'var(--text2)', cursor: 'not-allowed' }} value={me.account.email} readOnly aria-readonly="true" aria-describedby="p-e-h" /><span id="p-e-h" className="xs faint">This is your sign-in email. To change it, write to info@nm7.si from this address.</span></div>
          <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="p-p" className="label">Mobile (WhatsApp)</label><input id="p-p" className="input" style={{ height: 42 }} value={f.phone} onChange={set('phone')} aria-invalid={!!errs.phone} aria-describedby={errs.phone ? 'p-p-err' : undefined} />{errs.phone && <span id="p-p-err" className="error">{errs.phone}</span>}</div>
        </div>
        {error && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</span>}
        <div className="row g8"><button type="submit" className="btn btn-ink" disabled={busy}>{busy ? <Spinner /> : 'Save'}</button><Link to="/me/profile" className="btn btn-outline">Target role, cities &amp; career details → Job Profile</Link></div>
      </form>

      <section className="card stack g12" aria-label="Notifications">
        <strong>Notifications</strong>
        <div className="table-wrap"><table className="table"><thead><tr><th>Event</th>{CHANNELS.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
          <tbody>{EVENTS.map(([ev, l]) => <tr key={ev}><td className="small">{l}</td>{CHANNELS.map(([ch, cl]) => <td key={ch}><input type="checkbox" aria-label={`${l} on ${cl}`} checked={!!me.account.notify[ch][ev]} disabled={ev === 'order' && ch === 'email'} onChange={(e) => notify(ch, ev, e.target.checked)} /></td>)}</tr>)}</tbody></table></div>
        <span className="xs faint">Order emails stay on — they carry your receipts and refund updates.</span>
      </section>

      <ChangePassword />

      <section className="card stack g12" aria-label="Privacy">
        <strong>Privacy</strong>
        <div className="row between g8"><span className="small">Download everything we hold about you — resumes, orders, messages, applications.</span><button type="button" className="btn btn-outline" onClick={exportAll}>Download my data</button></div>
        <div className="row between g8"><span className="small">Expert files are kept for {PROMISES.retentionDays} days after delivery. Your own resumes stay until you delete them.</span></div>
        {canSave() && <div className="row between g8"><span className="small">Your LinkedIn link, the text from your LinkedIn PDF or pasted sections, and your checks. Kept on your account only, never shared with organizations.</span><button type="button" className="btn btn-outline" onClick={() => setLiDel(true)}>Delete my LinkedIn data</button></div>}
        {canSave() && <div className="row between g8"><span className="small">Job posts you matched, their scores, tailoring suggestions, cover letters and interview prep. Kept on your account only, never shared with organizations.</span><button type="button" className="btn btn-outline" onClick={() => setJobDel(true)}>Delete my job-search data</button></div>}
        <div className="row between g8"><span className="small" style={{ color: 'var(--danger)' }}>Delete my account and all my data.</span><button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setDel(true)}>Delete account</button></div>
      </section>
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
            if (!LIVE) { resetMe(); setDel(false); setConfirm(''); toast('Deletion requested — we confirm by email. (Preview: sample data reset.)'); return; }
            try { await deleteLinkedIn().catch(() => {}); await deleteJobData().catch(() => {}); await raiseIssue({ topic: 'Account', text: 'Please delete my account and all my data.' }); setDel(false); setConfirm(''); toast('Deletion requested — our team confirms by email within 7 days.'); } catch (err) { toast(err.message); }
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
    <form className="card stack g12" onSubmit={submit} aria-label="Change password" noValidate>
      <strong>Change password</strong>
      <div className="row g12">
        <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="pw-c" className="label">Current password</label><input id="pw-c" type="password" autoComplete="current-password" className="input" style={{ height: 42 }} value={p.current} onChange={set('current')} /></div>
        <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="pw-n" className="label">New password</label><input id="pw-n" type="password" autoComplete="new-password" className="input" style={{ height: 42 }} value={p.next} onChange={set('next')} aria-invalid={!!issue} aria-describedby="pw-n-h" /><span id="pw-n-h" className="xs" style={{ color: issue ? 'var(--danger)' : 'var(--text3)' }}>{issue || 'At least 8 characters, with letters and a number.'}</span></div>
        <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="pw-a" className="label">Re-type new password</label><input id="pw-a" type="password" autoComplete="new-password" className="input" style={{ height: 42 }} value={p.again} onChange={set('again')} aria-invalid={!!mismatch} />{mismatch && <span className="xs" style={{ color: 'var(--danger)' }}>The two passwords don’t match.</span>}</div>
      </div>
      {error && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</span>}
      <span className="xs faint">Changing it signs you out on every other device.</span>
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
  return (
    <>
      <MeHead title="Help & referral" />
      <section className="card stack g8" aria-label="Questions">
        <strong>Common questions</strong>
        {FAQ.map(([q, a]) => <details key={q} className="well"><summary className="small" style={{ fontWeight: 600, cursor: 'pointer' }}>{q}</summary><p className="small muted" style={{ margin: '8px 0 0' }}>{a}</p></details>)}
      </section>
      <div className="row g16" style={{ alignItems: 'flex-start' }}>
        <form className="card stack g12" style={{ flex: '1 1 340px' }} aria-label="Raise an issue" onSubmit={async (e) => {
          e.preventDefault();
          if (sending || t.text.trim().length < 10) return;
          setSending(true); setSendError('');
          try { await raiseIssue({ topic: t.topic, order: t.order || null, text: t.text.trim() }); setT({ ...t, text: '' }); toast('Sent — our team replies by email within 24 hours'); } catch (err) { setSendError(err.message || 'Not sent. Please try again.'); } finally { setSending(false); }
        }}>
          <strong>Raise an issue</strong>
          <div className="row g8">
            <div className="field" style={{ flex: 1 }}><label htmlFor="is-t" className="label">About</label><select id="is-t" className="input" style={{ height: 42 }} value={t.topic} onChange={(e) => setT({ ...t, topic: e.target.value })}>{['Order', 'Payment', 'Refund', 'Expert', 'Builder', 'Account', 'Other'].map((x) => <option key={x}>{x}</option>)}</select></div>
            <div className="field" style={{ flex: 1 }}><label htmlFor="is-o" className="label">Order</label><select id="is-o" className="input" style={{ height: 42 }} value={t.order} onChange={(e) => setT({ ...t, order: e.target.value })}><option value="">None</option>{me.orders.map((o) => <option key={o.id}>{o.id}</option>)}</select></div>
          </div>
          <div className="field"><label htmlFor="is-x" className="label">What happened?</label><textarea id="is-x" className="input" rows={4} value={t.text} onChange={(e) => setT({ ...t, text: e.target.value })} /></div>
          {sendError && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{sendError}</span>}
          <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={sending || t.text.trim().length < 10}>{sending ? <Spinner /> : 'Send to support'}</button>
          {me.issues.map((i) => (
            <div key={i.id} className="well stack g4">
              <span className="row between g8"><strong className="small">{i.id} · {i.topic}{i.order ? ` · ${i.order}` : ''}</strong><span className={`badge ${i.status === 'resolved' ? 'b-success' : 'b-warning'}`}>{i.status === 'resolved' ? 'Resolved' : 'Open'}</span></span>
              <span className="small">{i.text}</span>
              {i.reply && <span className="small muted"><strong>Support:</strong> {i.reply}</span>}
              <span className="xs faint">{fmtDay(i.at)}</span>
            </div>
          ))}
        </form>
        <section className="card stack g12" style={{ flex: '1 1 300px' }} aria-label="Refer a friend">
          <strong>Refer a friend</strong>
          <span className="small muted">{REFERRAL.reward ? `You get ${inr(REFERRAL.reward)} when a friend buys any plan.` : 'Share your link — we count every friend who joins. Rewards are announced soon and count from today.'}</span>
          <div className="well row between g8"><span className="mono small">{link}</span><button type="button" className="btn btn-outline" style={{ minHeight: 34 }} onClick={async () => { try { await navigator.clipboard.writeText(`https://${link}`); toast('Link copied'); } catch { toast(`Copy this: https://${link}`); } }}>Copy</button></div>
          <a className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} href={`https://wa.me/?text=${encodeURIComponent(`I fixed my resume on Nm7 — try it: https://${link}`)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
          <span className="small"><strong>{me.referrals.length}</strong> friends joined · <strong>{me.referrals.filter((r) => r.status === 'bought').length}</strong> bought a plan</span>
          {me.referrals.map((r) => <span key={r.name + r.at} className="xs muted">{r.name} · {r.status === 'bought' ? 'bought a plan' : 'joined'} · {fmtDay(r.at)}</span>)}
        </section>
      </div>
    </>
  );
}

