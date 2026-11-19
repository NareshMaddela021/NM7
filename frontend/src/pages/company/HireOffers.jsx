// Offers for one job (Phase 5, H6), under the Hire now tab. Send an offer from a template to someone who accepted
// your invite (salary a month or LPA, join date, place, a note, days to answer); see the answer; download the PDF;
// after the join date mark Joined or Didn't join (with a reason). Accept is a record of the answer (typed name, tick,
// time), not a legal e-signature. No pop-up dialogs. English, Telugu and Hindi (co.offer.*).
// Round P, Phase 3: offer cards (name, salary in large type, status chip, join date) and a send form in grouped cards.
import { useCallback, useEffect, useState } from 'react';
import { readAccount } from '../../lib/recruiterPortal';
import { rq } from '../../lib/company';
import { API_BASE } from '../../services/http';
import { fmtDay } from '../../lib/format';
import '../../styles/company-hire.css';
import { IcDownload, IcEdit } from '../../components/icons';

const TONE = { sent: 'mchip-info', accepted: 'mchip-ok', joined: 'mchip-ok', declined: 'mchip-bad', dropped: 'mchip-bad', expired: 'mchip-neutral', withdrawn: 'mchip-neutral' };
const BLANK = { amount: '', unit: 'month', joinDate: '', place: '', notes: '', respondDays: '3' };

export default function HireOffers({ t, c, job, people, canEdit }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState(null); // { person, ...BLANK }
  const [why, setWhy] = useState({});
  const [err, setErr] = useState('');
  const load = useCallback(() => rq(`/api/company/${c.id}/hire/offers?job=${encodeURIComponent(job)}`).then(setList, () => setList([])), [c.id, job]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn) => { setErr(''); try { await fn(); await load(); return true; } catch (x) { setErr(x.message); return false; } };
  const send = (e) => {
    e.preventDefault();
    act(async () => {
      await rq(`/api/company/${c.id}/hire/offers`, { method: 'POST', body: { job, person: form.person, salary: { amount: Number(form.amount), unit: form.unit }, joinDate: form.joinDate, place: form.place, notes: form.notes, respondDays: Number(form.respondDays) } });
      setForm(null);
    });
  };
  const pdf = async (id) => {
    const r = await fetch(`${API_BASE}/api/company/${c.id}/hire/offers/${id}/pdf`, { headers: { 'X-Recruiter-Account': readAccount() } });
    const url = URL.createObjectURL(await r.blob());
    Object.assign(document.createElement('a'), { href: url, download: 'offer.pdf' }).click();
    URL.revokeObjectURL(url);
  };
  const offered = new Set(list.filter((o) => ['sent', 'accepted', 'joined'].includes(o.status)).map((o) => o.person));
  const ready = people.filter((p) => !offered.has(p.key));
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className="mcard ho" aria-labelledby="co-offers-h" data-testid="co-offers">
      <header className="mcard-h"><span className="mcard-ic blue" aria-hidden="true"><IcEdit /></span><span className="mcard-ht"><strong id="co-offers-h" className="mcard-title">{t('co.offer.title')}</strong><span className="mcard-sub">{t('co.offer.intro')}</span></span></header>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      {list.length > 0 && (
        <ul className="ho-list">
          {list.map((o) => (
            <li key={o.id} className={`ho-offer ho-${o.status}`} data-testid="co-offer">
              <div className="ho-top">
                <span className="mavatar hn-av-blue" aria-hidden="true">{(o.candidate || '?').trim().charAt(0).toUpperCase()}</span>
                <span className="ho-who"><strong>{o.candidate}</strong><span className="ho-sal">{o.salaryText}</span></span>
                <span className={`mchip ${TONE[o.status]}`} data-testid="co-offer-state">{t(`co.offer.state.${o.status}`)}</span>
              </div>
              <span className="ho-meta">{t('co.offer.joins', { date: fmtDay(o.joinDate) })}{o.typedName ? ` · ${t('co.offer.signed', { name: o.typedName })}` : ''}{o.declineReason || o.dropReason ? ` · ${o.declineReason || o.dropReason}` : ''}</span>
              <div className="ho-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => pdf(o.id)} data-testid="co-offer-pdf"><IcDownload size={16} /> {t('co.offer.pdf')}</button>
                {canEdit && o.status === 'accepted' && o.joinDate <= today && (why[o.id] !== undefined ? (
                  <span className="hsl-cancel">
                    <input className="input" maxLength={300} aria-label={t('co.offer.why')} placeholder={t('co.offer.why')} value={why[o.id]} onChange={(e) => setWhy({ ...why, [o.id]: e.target.value })} />
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => act(() => rq(`/api/company/${c.id}/hire/offers/${o.id}/joined`, { method: 'POST', body: { joined: false, reason: why[o.id] } }))}>{t('co.offer.save')}</button>
                  </span>
                ) : (
                  <>
                    <button type="button" className="btn btn-signal btn-sm" onClick={() => act(() => rq(`/api/company/${c.id}/hire/offers/${o.id}/joined`, { method: 'POST', body: { joined: true } }))} data-testid="co-offer-joined">{t('co.offer.joined')}</button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setWhy({ ...why, [o.id]: '' })}>{t('co.offer.notJoined')}</button>
                  </>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canEdit && ready.length > 0 && (form ? (
        <form className="ho-form" onSubmit={send} aria-label={t('co.offer.send')} data-testid="co-offer-form">
          <label className="field"><span className="label">{t('co.offer.who')}</span>
            <select className="input" value={form.person} onChange={set('person')} data-testid="co-offer-person">{ready.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></label>
          <div className="ho-grid">
            <label className="field"><span className="label">{t('co.offer.salary')}</span><input className="input" inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.]/g, '') })} data-testid="co-offer-amount" /></label>
            <label className="field"><span className="label">{t('co.offer.per')}</span><select className="input" value={form.unit} onChange={set('unit')}><option value="month">{t('co.offer.month')}</option><option value="lpa">LPA</option></select></label>
            <label className="field"><span className="label">{t('co.offer.joinDate')}</span><input type="date" className="input" required min={today} value={form.joinDate} onChange={set('joinDate')} data-testid="co-offer-join" /></label>
            <label className="field"><span className="label">{t('co.offer.place')}</span><input className="input" maxLength={120} value={form.place} onChange={set('place')} /></label>
          </div>
          <label className="field"><span className="label">{t('co.offer.notes')}</span><textarea className="input" rows={2} maxLength={1000} value={form.notes} onChange={set('notes')} /></label>
          <label className="field ho-days"><span className="label">{t('co.offer.days')}</span><input className="input" inputMode="numeric" value={form.respondDays} onChange={set('respondDays')} /></label>
          <div className="hb-actions"><button type="submit" className="btn btn-signal" data-testid="co-offer-send">{t('co.offer.send')}</button><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>{t('co.slots.close')}</button></div>
        </form>
      ) : <button type="button" className="btn btn-outline ho-new" onClick={() => setForm({ person: ready[0].key, ...BLANK })} data-testid="co-offer-new"><span aria-hidden="true">+ </span>{t('co.offer.new')}</button>)}
    </section>
  );
}
