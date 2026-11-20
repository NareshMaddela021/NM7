// Admin -> Skill checks -> Vetting Trust -> "Interview booking & joining day" (T11). The times of the reminders and the
// joining-day messages, the 2-hour change window, how long a link works, the WhatsApp cap a person a day, the five
// WhatsApp templates to submit to Meta (with "Meta approved it" per language: a real provider only sends approved
// ones), counts (24 h / 30 days), the latest links (never a token) and "Run a pass now". Uses T5's WhatsApp provider
// and quiet hours (the Calls & WhatsApp card above). All changes audited.
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { Loading, http, useAction, useApi, when } from './common';

const TIMES = [['eveAt', 'Evening before (IST)'], ['morningAt', 'Joining-day morning'], ['checkinAt', '“I’ve joined” check-in'], ['companyAt', 'Company “did they join?”']];
const NUMS = [['soonHours', 'Reminder hours before', 1, 6], ['changeHours', 'Move / cancel until (hours before)', 1, 24], ['linkDays', 'A link works (days)', 1, 30], ['perPersonDay', 'WhatsApp a person a day', 1, 10]];
const COUNTS = [['invite', 'Booking links sent'], ['booked', 'Booked'], ['moved', 'Moved'], ['cancelled', 'Cancelled'], ['cant', 'Can’t make it'], ['wa', 'WhatsApp messages'], ['email', 'Emails'], ['join_coming', 'Coming (joining)'], ['join_reschedule', 'Reschedule asked'], ['join_joined', 'Joined'], ['join_not_joined', 'Didn’t join']];
const LANG = { en: 'English', hi: 'Hindi', te: 'Telugu' };

export default function TrustBookingAdmin() {
  const st = useApi('/api/admin/trust/booking');
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(null);
  useEffect(() => { if (st.data) setF({ ...st.data.settings }); }, [st.data]);
  return (
    <section className="card stack g12" aria-labelledby="tbk-h" data-testid="tbk-card">
      <h2 id="tbk-h" className="h3" style={{ margin: 0 }}>Interview booking & joining day</h2>
      <Loading st={st}>{(d) => {
        if (!f) return null;
        const save = () => run(async () => { await http('/api/admin/trust/booking', { method: 'PUT', body: { ...f, ...Object.fromEntries(NUMS.map(([k]) => [k, Number(f[k])])) } }); st.reload(); }, 'Saved');
        const runNow = () => run(async () => { const r = await http('/api/admin/trust/booking/run', { method: 'POST' }); toast(`Ran: ${Object.entries(r.ran).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing due'}`); st.reload(); });
        return (
          <>
            <p className="small" style={{ margin: 0 }}>People a company shortlists or invites get a one-tap link (WhatsApp with the Calls & WhatsApp consent, and email) to pick an interview time with no sign-in; reminders the evening before and a few hours before; for accepted offers, “See you tomorrow”, “Good luck” and “I’ve joined”, and the company’s one-tap “Did they join?”. They replace the old reminder emails for these people. {d.public ? 'Live for everyone.' : 'While Vetting Trust is hidden: only testers, admins and the demo company, and only test companies; emails only to testers.'}</p>
            <label className="row g8" style={{ alignItems: 'center', minHeight: 44 }}><input type="checkbox" checked={f.on} onChange={(e) => setF({ ...f, on: e.target.checked })} data-testid="tbk-on" /> <span className="small">On (off: everyone keeps the old Hire reminders)</span></label>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              {TIMES.map(([k, l]) => <div key={k} className="field" style={{ flex: '1 1 150px' }}><label className="label" htmlFor={`tbk-${k}`}>{l}</label><input id={`tbk-${k}`} type="time" className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`tbk-${k}`} /></div>)}
              {NUMS.map(([k, l, lo, hi]) => <div key={k} className="field" style={{ flex: '1 1 150px' }}><label className="label" htmlFor={`tbk-${k}`}>{l}</label><input id={`tbk-${k}`} type="number" min={lo} max={hi} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`tbk-${k}`} /></div>)}
            </div>
            <span className="xs muted">WhatsApp waits for the quiet hours and the person’s quiet days (Calls & WhatsApp above) and is dropped if it would arrive too late; email goes at the time.</span>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy} onClick={save} data-testid="tbk-save">Save</button>
              <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={runNow} data-testid="tbk-run">Run a pass now</button>
            </div>
            <div className="table-wrap mtable-wrap vt-scroll">
              <table className="table mtable vt-table" data-testid="tbk-counts">
                <thead><tr><th>Count</th><th>24 hours</th><th>30 days</th></tr></thead>
                <tbody>{COUNTS.map(([k, l]) => <tr key={k}><th scope="row" className="small">{l}</th><td data-label="24 hours" className="num">{d.counts.today[k] || 0}</td><td data-label="30 days" className="num">{d.counts.d30[k] || 0}</td></tr>)}</tbody>
              </table>
            </div>
            <details data-testid="tbk-templates">
              <summary className="small"><strong>WhatsApp templates to submit to Meta</strong> (5 templates × 3 languages, category UTILITY)</summary>
              <div className="stack g8" style={{ marginTop: 8 }}>
                {Object.keys(LANG).map((lang) => (
                  <div key={lang} className="card stack g4" style={{ minWidth: 0 }}>
                    <strong className="small">{LANG[lang]}</strong>
                    {d.templates.filter((t) => t.lang === lang).map((t) => <span key={t.name} className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><strong>{t.name}:</strong> {t.body}</span>)}
                    <label className="row g8" style={{ alignItems: 'center', minHeight: 44 }}><input type="checkbox" checked={!!f.approved?.[lang]} onChange={(e) => setF({ ...f, approved: { ...f.approved, [lang]: e.target.checked } })} data-testid={`tbk-approved-${lang}`} /> <span className="small">Meta approved all five</span></label>
                  </div>
                ))}
              </div>
            </details>
            <details data-testid="tbk-links">
              <summary className="small"><strong>Latest links</strong> ({d.joinEvents} joining answers kept)</summary>
              <ul className="xs" style={{ margin: '8px 0 0', paddingLeft: 18 }}>{d.links.map((x, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>{x.kind} · {x.user} · {x.source} · until {when(x.expiresAt)}{x.invite.wa ? ` · WhatsApp ${x.invite.wa}` : ''}{x.invite.email ? ` · email ${x.invite.email}` : ''} · {x.bookings} booking{x.bookings === 1 ? '' : 's'}</li>)}</ul>
            </details>
          </>
        );
      }}</Loading>
    </section>
  );
}
