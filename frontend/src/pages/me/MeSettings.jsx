// Profile & settings (auto-fills the builder), notifications per channel, privacy (download data, delete account).
// Also Help & referral.
import { useState } from 'react';
import { Dialog, useToast } from '../../components/ui';
import { useMe, setMe, getMe, resetMe, activeResume, setResumeData } from '../../lib/customerStore';
import { useExpertOrders } from '../../lib/expertStore';
import { EXP_LEVELS } from '../builder/schema';
import { savePdf } from '../builder/resumePdf';
import { PROMISES, REFERRAL, inr } from '../../lib/pricing';
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
  const [confirm, setConfirm] = useState('');
  const errs = { email: !EMAIL_RE.test(f.email) && 'Enter a valid email', phone: f.phone && !PHONE_RE.test(f.phone.trim()) && 'Enter a 10-digit Indian mobile number' };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = (e) => {
    e.preventDefault(); if (errs.email || errs.phone) return;
    setMe(() => ({ account: f }));
    toast('Saved');
  };
  const fillResume = () => {
    const r = activeResume(getMe());
    const d = { ...r.data, personal: { ...r.data.personal, name: f.name, email: f.email, phone: f.phone, level: f.level, headline: r.data.personal.headline || f.targetRole }, prefs: { ...r.data.prefs, locations: f.cities } };
    setResumeData(r.id, d);
    toast(`Filled into “${r.name}”`);
  };
  const exportAll = async () => {
    const s = getMe();
    const data = { exportedAt: new Date().toISOString(), account: s.account, orders: s.orders, expertOrders: all.filter((x) => s.orders.some((o) => o.id === x.id)).map(({ id, status, versions, messages, comments }) => ({ id, status, versions, messages, comments })), resumes: s.resumes, coverLetters: s.covers, applications: s.apps, atsChecks: s.checks, shareLink: s.share, issues: s.issues };
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
          <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="p-n" className="label">Full name</label><input id="p-n" className="input" style={{ height: 42 }} value={f.name} onChange={set('name')} /></div>
          <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="p-e" className="label">Email</label><input id="p-e" type="email" className="input" style={{ height: 42 }} value={f.email} onChange={set('email')} aria-invalid={!!errs.email} />{errs.email && <span className="xs" style={{ color: 'var(--danger)' }}>{errs.email}</span>}</div>
          <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="p-p" className="label">Mobile (WhatsApp)</label><input id="p-p" className="input" style={{ height: 42 }} value={f.phone} onChange={set('phone')} aria-invalid={!!errs.phone} />{errs.phone && <span className="xs" style={{ color: 'var(--danger)' }}>{errs.phone}</span>}</div>
        </div>
        <div className="row g12">
          <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="p-r" className="label">Target role</label><input id="p-r" className="input" style={{ height: 42 }} value={f.targetRole} onChange={set('targetRole')} /></div>
          <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="p-c" className="label">Preferred cities</label><input id="p-c" className="input" style={{ height: 42 }} value={f.cities} onChange={set('cities')} /></div>
          <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="p-l" className="label">Experience</label><select id="p-l" className="input" style={{ height: 42 }} value={f.level} onChange={set('level')}>{EXP_LEVELS.map((l) => <option key={l}>{l}</option>)}</select></div>
        </div>
        <div className="row g8"><button type="submit" className="btn btn-ink">Save</button><button type="button" className="btn btn-outline" onClick={fillResume}>Fill these into my resume</button></div>
      </form>

      <section className="card stack g12" aria-label="Notifications">
        <strong>Notifications</strong>
        <div className="table-wrap"><table className="table"><thead><tr><th>Event</th>{CHANNELS.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
          <tbody>{EVENTS.map(([ev, l]) => <tr key={ev}><td className="small">{l}</td>{CHANNELS.map(([ch, cl]) => <td key={ch}><input type="checkbox" aria-label={`${l} on ${cl}`} checked={!!me.account.notify[ch][ev]} disabled={ev === 'order' && ch === 'email'} onChange={(e) => notify(ch, ev, e.target.checked)} /></td>)}</tr>)}</tbody></table></div>
        <span className="xs faint">Order emails stay on — they carry your receipts and refund updates.</span>
      </section>

      <section className="card stack g12" aria-label="Privacy">
        <strong>Privacy</strong>
        <div className="row between g8"><span className="small">Download everything we hold about you — resumes, orders, messages, applications.</span><button type="button" className="btn btn-outline" onClick={exportAll}>Download my data</button></div>
        <div className="row between g8"><span className="small">Expert files are kept for {PROMISES.retentionDays} days after delivery. Your own resumes stay until you delete them.</span></div>
        <div className="row between g8"><span className="small" style={{ color: 'var(--danger)' }}>Delete my account and all my data.</span><button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setDel(true)}>Delete account</button></div>
      </section>
      {del && (
        <Dialog showTitle title="Delete your account?" onClose={() => setDel(false)}>
          <form className="stack g12" onSubmit={(e) => { e.preventDefault(); resetMe(); setDel(false); setConfirm(''); toast('Deletion requested — we confirm by email. (Preview: sample data reset.)'); }}>
            <span className="small muted">This deletes your resumes, cover letters, applications and messages. Invoices are kept as the law requires. Download your data first if you want a copy.</span>
            <label htmlFor="del" className="label">Type DELETE to confirm</label>
            <input id="del" className="input" style={{ height: 42 }} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button type="submit" className="btn btn-ink" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} disabled={confirm !== 'DELETE'}>Delete my account</button>
          </form>
        </Dialog>
      )}
    </>
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
  const link = `nm7.si/?ref=${me.account.referralCode}`;
  return (
    <>
      <MeHead title="Help & referral" />
      <section className="card stack g8" aria-label="Questions">
        <strong>Common questions</strong>
        {FAQ.map(([q, a]) => <details key={q} className="well"><summary className="small" style={{ fontWeight: 600, cursor: 'pointer' }}>{q}</summary><p className="small muted" style={{ margin: '8px 0 0' }}>{a}</p></details>)}
      </section>
      <div className="row g16" style={{ alignItems: 'flex-start' }}>
        <form className="card stack g12" style={{ flex: '1 1 340px' }} aria-label="Raise an issue" onSubmit={(e) => { e.preventDefault(); setMe((s) => ({ issues: [{ id: `T-${200 + s.issues.length + 5}`, ...t, text: t.text.trim(), at: Date.now(), status: 'open' }, ...s.issues] })); setT({ ...t, text: '' }); toast('Sent — our team replies within 24 hours'); }}>
          <strong>Raise an issue</strong>
          <div className="row g8">
            <div className="field" style={{ flex: 1 }}><label htmlFor="is-t" className="label">About</label><select id="is-t" className="input" style={{ height: 42 }} value={t.topic} onChange={(e) => setT({ ...t, topic: e.target.value })}>{['Order', 'Payment', 'Refund', 'Expert', 'Builder', 'Account', 'Other'].map((x) => <option key={x}>{x}</option>)}</select></div>
            <div className="field" style={{ flex: 1 }}><label htmlFor="is-o" className="label">Order</label><select id="is-o" className="input" style={{ height: 42 }} value={t.order} onChange={(e) => setT({ ...t, order: e.target.value })}><option value="">None</option>{me.orders.map((o) => <option key={o.id}>{o.id}</option>)}</select></div>
          </div>
          <div className="field"><label htmlFor="is-x" className="label">What happened?</label><textarea id="is-x" className="input" rows={4} value={t.text} onChange={(e) => setT({ ...t, text: e.target.value })} /></div>
          <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={t.text.trim().length < 10}>Send to support</button>
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

