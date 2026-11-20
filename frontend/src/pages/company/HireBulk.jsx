// Bulk hiring mode for one job (Phase 5, H7), at the top of the Hire now tab: turn it on for 20–500 openings (a paid
// company feature, open to every Verified company by default); then a progress board, batch status and offers for
// everyone who accepted, a CSV of the whole pipeline, and a walk-in drive day with a QR code people scan to check in.
// No pop-up dialogs. English, Telugu and Hindi (co.bulk.*).
// Round P, Phase 3: a board card with a filled bar, the funnel as numbered tiles with arrows, actions as pills and the
// walk-in day as its own card (QR in a frame beside the time, place and check-ins).
import { useCallback, useEffect, useState } from 'react';
import { readAccount } from '../../lib/recruiterPortal';
import { rq } from '../../lib/company';
import { API_BASE } from '../../services/http';
import '../../styles/company-hire.css';
import { IcDownload, IcPin, IcUsers } from '../../components/icons';

const STAGES = ['applied', 'viewed', 'shortlisted', 'interview', 'offer', 'rejected']; // the job-board statuses (jobs.app.*)
const STATS = ['invited', 'accepted', 'interviewsBooked', 'attended', 'offersSent', 'offersAccepted', 'joined', 'checkedIn'];

export default function HireBulk({ t, c, job, people, canEdit, onChange }) {
  const [b, setB] = useState(undefined); // undefined: loading; null: off
  const [openings, setOpenings] = useState('50');
  const [walk, setWalk] = useState(null);
  const [wf, setWf] = useState({ date: '', time: '10:00', place: '' });
  const [qr, setQr] = useState('');
  const [offer, setOffer] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    try {
      setB(await rq(`/api/company/${c.id}/hire/bulk/${job}/board`));
      const w = await rq(`/api/company/${c.id}/hire/bulk/${job}/walkin`);
      setWalk(w);
      if (w) {
        const { qrCanvas } = await import('../../lib/qr');
        try { setQr((await qrCanvas(`${window.location.origin}${w.path}`, 220)).toDataURL('image/png')); } catch { setQr(''); }
      }
    } catch { setB(null); }
  }, [c.id, job]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn, said) => { setErr(''); setMsg(''); try { await fn(); if (said) setMsg(said); await load(); onChange?.(); } catch (x) { setErr(x.message); } };
  const toggle = (on) => act(() => rq(`/api/company/${c.id}/hire/bulk/${job}`, { method: 'PUT', body: { on, openings: Number(openings) || 20 } }));
  const csv = async () => {
    const r = await fetch(`${API_BASE}/api/company/${c.id}/hire/bulk/${job}/csv`, { headers: { 'X-Recruiter-Account': readAccount() } });
    const url = URL.createObjectURL(await r.blob());
    Object.assign(document.createElement('a'), { href: url, download: `hiring-${job}.csv` }).click();
    URL.revokeObjectURL(url);
  };
  if (b === undefined) return null;
  if (!b) {
    return canEdit ? (
      <section className="mcard hb-off" data-testid="co-bulk-off">
        <header className="mcard-h"><span className="mcard-ic blue" aria-hidden="true"><IcUsers /></span><span className="mcard-ht"><strong className="mcard-title">{t('co.bulk.title')}</strong><span className="mcard-sub">{t('co.bulk.offIntro')}</span></span></header>
        {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
        <span className="hb-off-row">
          <label className="field hb-openings"><span className="label">{t('co.bulk.openings')}</span><input className="input" inputMode="numeric" value={openings} onChange={(e) => setOpenings(e.target.value.replace(/\D/g, ''))} data-testid="co-bulk-openings" /></label>
          <button type="button" className="btn btn-signal" onClick={() => toggle(true)} data-testid="co-bulk-on">{t('co.bulk.turnOn')}</button>
        </span>
      </section>
    ) : null;
  }
  // the board's own list of people who accepted, so the buttons always match its "accepted" count (even after a reload)
  const accepted = b.people || people;
  const ids = accepted.map((p) => p.key);
  const toInterview = b.toInterview || ids;
  const toOffer = b.toOffer || ids; // who accepted and has no offer yet
  // where applicants are now, in pipeline order ("1 at Offer stage")
  const now = STAGES.filter((k) => b.stages?.[k]).map((k) => t('co.bulk.atStage', { n: b.stages[k], stage: t(`jobs.app.${k}`) }));
  return (
    <section className="mcard hb" aria-labelledby="co-bulk-h" data-testid="co-bulk">
      <header className="hb-head">
        <span className="mcard-ic blue" aria-hidden="true"><IcUsers /></span>
        <strong id="co-bulk-h" className="mcard-title">{t('co.bulk.board', { n: b.openings })}</strong>
        <span className="mchip mchip-ok" data-testid="co-bulk-filled">{t('co.bulk.filled', { pct: b.filledPct, n: b.joined })}</span>
      </header>
      <span className="hb-fill" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, b.filledPct || 0))}%` }} /></span>
      <div className="hb-funnel" role="list" data-testid="co-bulk-stats">
        {STATS.map((k, i) => <div key={k} role="listitem" className={`hb-stage ${b[k] ? 'hb-stage-on' : ''} ${i === STATS.length - 1 ? 'hb-stage-walk' : ''}`}><strong>{b[k]}</strong><span>{t(`co.bulk.stat.${k}`)}</span></div>)}
      </div>
      <span className="hb-note" data-testid="co-bulk-funnel-note">{t('co.bulk.funnelNote')}</span>
      {now.length > 0 && <p className="hb-now" data-testid="co-bulk-now">{t('co.bulk.now')} {now.join(' · ')}</p>}
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      {msg && <p className="small" role="status" style={{ margin: 0 }} data-testid="co-bulk-msg">{msg}</p>}
      {canEdit && (
        <div className="hb-actions">
          <button type="button" className="btn btn-outline" disabled={!toInterview.length} onClick={() => act(() => rq(`/api/company/${c.id}/hire/bulk/${job}/status`, { method: 'POST', body: { people: toInterview, status: 'interview' } }), t('co.bulk.moved'))} data-testid="co-bulk-interview">{toInterview.length ? t('co.bulk.allInterview', { n: toInterview.length }) : t('co.bulk.noneInterview')}</button>
          <button type="button" className="btn btn-outline" disabled={!toOffer.length} onClick={() => setOffer({ amount: '', unit: 'month', joinDate: '' })} data-testid="co-bulk-offer">{toOffer.length ? t('co.bulk.allOffer', { n: toOffer.length }) : t('co.bulk.noneOffer')}</button>
          <button type="button" className="btn btn-ghost" onClick={csv} data-testid="co-bulk-csv"><IcDownload size={16} /> {t('co.bulk.csv')}</button>
          <button type="button" className="btn btn-ghost" onClick={() => toggle(false)}>{t('co.bulk.turnOff')}</button>
        </div>
      )}
      {offer && (
        <form className="hb-form" onSubmit={(e) => { e.preventDefault(); act(async () => { const r = await rq(`/api/company/${c.id}/hire/bulk/${job}/offers`, { method: 'POST', body: { people: toOffer, salary: { amount: Number(offer.amount), unit: offer.unit }, joinDate: offer.joinDate } }); setOffer(null); setMsg(t('co.bulk.offersSent', { n: r.sent })); }); }} data-testid="co-bulk-offer-form">
          <label className="field"><span className="label">{t('co.offer.salary')}</span><input className="input" required inputMode="decimal" value={offer.amount} onChange={(e) => setOffer({ ...offer, amount: e.target.value.replace(/[^\d.]/g, '') })} /></label>
          <label className="field"><span className="label">{t('co.offer.per')}</span><select className="input" value={offer.unit} onChange={(e) => setOffer({ ...offer, unit: e.target.value })}><option value="month">{t('co.offer.month')}</option><option value="lpa">LPA</option></select></label>
          <label className="field"><span className="label">{t('co.offer.joinDate')}</span><input type="date" className="input" required value={offer.joinDate} onChange={(e) => setOffer({ ...offer, joinDate: e.target.value })} /></label>
          <span className="hb-form-btns"><button type="submit" className="btn btn-signal">{t('co.offer.send')}</button><button type="button" className="btn btn-ghost" onClick={() => setOffer(null)}>{t('co.slots.close')}</button></span>
        </form>
      )}
      <div className="hb-walk" data-testid="co-walkin">
        <strong className="hb-walk-title"><IcPin /> {t('co.bulk.walkin')}</strong>
        {walk ? (
          <div className="hb-walk-body">
            {qr && <span className="hb-qr"><img src={qr} alt={t('co.bulk.qrAlt')} width={160} height={160} /></span>}
            <span className="hb-walk-info">
              <span className="hb-walk-when">{new Date(walk.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })} · {walk.place}</span>
              <span className="xs muted hb-walk-link">{window.location.origin}{walk.path}</span>
              <span className="mchip mchip-info" data-testid="co-walkin-count">{t('co.bulk.checkedIn', { n: walk.checkins.length })}</span>
              {walk.checkins.length > 0 && <span className="small">{walk.checkins.map((x) => x.name).join(', ')}</span>}
            </span>
          </div>
        ) : canEdit && (
          <form className="hb-form" onSubmit={(e) => { e.preventDefault(); act(() => rq(`/api/company/${c.id}/hire/bulk/${job}/walkin`, { method: 'POST', body: wf })); }} data-testid="co-walkin-form">
            <label className="field"><span className="label">{t('co.slots.date')}</span><input type="date" className="input" required value={wf.date} onChange={(e) => setWf({ ...wf, date: e.target.value })} data-testid="co-walkin-date" /></label>
            <label className="field"><span className="label">{t('co.slots.time')}</span><input type="time" className="input" required value={wf.time} onChange={(e) => setWf({ ...wf, time: e.target.value })} /></label>
            <label className="field hb-place"><span className="label">{t('co.slots.place')}</span><input className="input" required minLength={3} maxLength={200} value={wf.place} onChange={(e) => setWf({ ...wf, place: e.target.value })} data-testid="co-walkin-place" /></label>
            <span className="hb-form-btns"><button type="submit" className="btn btn-signal" data-testid="co-walkin-make">{t('co.bulk.makeWalkin')}</button></span>
          </form>
        )}
      </div>
    </section>
  );
}
