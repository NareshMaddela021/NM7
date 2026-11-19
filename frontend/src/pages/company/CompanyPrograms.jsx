// Phase 6 S8: internships and 1–4 week live projects (Verified companies). Post one; accept up to the places you
// set; review the work students send; a completed one gets a certificate with a verification link. Unpaid is
// allowed and shown as "Unpaid"; work that looks like free labour is checked by Nm7 before students see it.
// English, Telugu and Hindi (co.pg.*). Round P, Phase 3: an intro card, program cards with status chips, a places
// bar and the applicants as rows with clear actions; the post form in grouped cards with big choice tiles.
import { useEffect, useId, useState } from 'react';
import { rq } from '../../lib/company';
import { Bar, Chip, Empty, FieldGroup, MeCard, Skel, StickyBar } from '../me/kit';
import '../../styles/me-kit.css';
import '../../styles/company-programs.css';
import { IcAlert, IcArrowRight, IcCap, IcTarget } from '../../components/icons';

const BLANK = { kind: 'project', title: '', brief: '', deliverable: '', deadline: '', weeks: '2', stipend: '', remote: true, city: '', seats: '5' };
const STATUS_TONE = { open: 'ok', review: 'warn', closed: 'neutral', removed: 'bad' };
const APP_TONE = { applied: 'info', accepted: 'accent', submitted: 'warn', completed: 'ok', not_completed: 'bad' };
const KIND_IC = { project: <IcTarget />, internship: <IcCap /> };
const initial = (s) => (s || '?').trim().charAt(0).toUpperCase();

function Applicant({ t, c, p, a, onChange }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const go = async (path, body) => {
    setBusy(true); setErr('');
    try { await rq(`/api/company/${c.id}/programs/${p.id}/applicants/${a.id}/${path}`, { method: 'POST', body }); onChange(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <li className={`cp-app cp-app-${a.status}`} data-testid="co-pg-app">
      <div className="cp-app-top">
        <span className="mavatar cp-avatar" aria-hidden="true">{initial(a.name)}</span>
        <span className="cp-app-main">
          <strong className="cp-app-name">{a.name}</strong>
          {a.note && <span className="cp-app-note">{a.note}</span>}
        </span>
        <Chip tone={APP_TONE[a.status] || 'neutral'}>{t(`co.pg.st.${a.status}`)}</Chip>
      </div>
      {a.status === 'applied' && <button type="button" className="btn btn-signal cp-btn" disabled={busy} onClick={() => go('accept')} data-testid="co-pg-accept">{t('co.pg.accept')}</button>}
      {a.status === 'submitted' && (
        <div className="cp-review">
          <div className="cp-work">
            <span className="cp-work-ic" aria-hidden="true"><IcArrowRight size={14} /></span>
            {a.submission.link ? <a className="cp-work-link" href={a.submission.link} target="_blank" rel="noopener noreferrer">{a.submission.link}</a> : <span className="cp-work-text">{a.submission.text}</span>}
          </div>
          <input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('co.pg.reviewNote')} aria-label={t('co.pg.reviewNote')} />
          <div className="cp-actions">
            <button type="button" className="btn btn-signal cp-btn" disabled={busy} onClick={() => go('review', { ok: true, note })} data-testid="co-pg-pass">{t('co.pg.pass')}</button>
            <button type="button" className="btn btn-outline cp-btn" disabled={busy} onClick={() => go('review', { ok: false, note })}>{t('co.pg.fail')}</button>
          </div>
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </li>
  );
}

function Program({ t, c, p, onChange }) {
  return (
    <section className="mcard cp-row" data-testid="co-pg-row" data-status={p.status}>
      <header className="cp-row-head">
        <span className="mcard-ic cp-kind-ic" aria-hidden="true">{KIND_IC[p.kind] || <IcTarget />}</span>
        <span className="cp-row-titles">
          <strong className="cp-row-title">{p.title}</strong>
          <span className="cp-facts">
            <span className="cp-fact">{t(`co.pg.kind.${p.kind}`)}</span>
            <span className={`cp-fact ${p.stipend ? 'cp-fact-pay' : ''}`}>{p.stipend ? `₹${p.stipend.toLocaleString('en-IN')}` : t('co.pg.unpaid')}</span>
          </span>
        </span>
        <Chip tone={STATUS_TONE[p.status] || 'neutral'} testid="co-pg-status">{t(`co.pg.status.${p.status}`)}</Chip>
      </header>
      <Bar value={p.accepted} max={Math.max(1, p.seats)} label={t('co.pg.places', { n: p.accepted, of: p.seats })} showValue={false} />
      {p.flags.length > 0 && <div className="cp-flags" role="note"><span aria-hidden="true"><IcAlert /></span><span data-testid="co-pg-flags">{t('co.pg.held')}: {p.flags.join('; ')}</span></div>}
      {p.applicants.length > 0 && (
        <div className="cp-apps">
          <ul className="cp-app-list">{p.applicants.map((a) => <Applicant key={a.id} t={t} c={c} p={p} a={a} onChange={onChange} />)}</ul>
        </div>
      )}
    </section>
  );
}

export default function CompanyPrograms({ t, c }) {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const uid = useId(); // every label is tied to its input by id (13 Nov live test: screen readers read "on" or nothing)
  const id = (k) => `${uid}-${k}`;
  const load = () => rq(`/api/company/${c.id}/programs`).then(setRows, (x) => { setErr(x.message); setRows([]); });
  useEffect(() => { load(); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (c.trust !== 'verified') {
    return (
      <section className="cp" data-testid="co-pg">
        <Empty shape="cap" tint="company" title={t('co.pg.title')}>{t('co.pg.basic')}</Empty>
      </section>
    );
  }
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const post = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await rq(`/api/company/${c.id}/programs`, { method: 'POST', body: { ...f, weeks: Number(f.weeks) || 1, stipend: Number(f.stipend) || 0, seats: Number(f.seats) || 1, deliverable: f.kind === 'project' ? f.deliverable : '', deadline: f.kind === 'project' ? f.deadline : '' } });
      setF(null); load();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <section className="cp stack g16" aria-label={t('co.pg.title')} data-testid="co-pg">
      <MeCard tone="accent" className="cp-intro" icon={<IcCap />} title={t('co.pg.title')} sub={t('co.pg.intro')} headingLevel={3} label={t('co.pg.title')}
        actions={!f && <button type="button" className="btn btn-signal" onClick={() => setF({ ...BLANK })} data-testid="co-pg-new">{t('co.pg.new')}</button>} />
      {f && (
        <form className="mcard cp-form" onSubmit={post} data-testid="co-pg-form">
          <fieldset className="mfields">
            <legend className="mfields-h">{t('co.pg.f.kind')}</legend>
            <div className="cp-kinds">
              {['project', 'internship'].map((k) => (
                <span key={k} className={`cp-kind ${f.kind === k ? 'on' : ''}`}>
                  <input type="radio" id={id(`kind-${k}`)} name="co-pg-kind" value={k} checked={f.kind === k} onChange={() => setF({ ...f, kind: k, weeks: k === 'project' ? '2' : '8' })} data-testid={`co-pg-kind-${k}`} />
                  <label htmlFor={id(`kind-${k}`)}><span className="cp-kind-ic" aria-hidden="true">{KIND_IC[k]}</span>{t(`co.pg.kind.${k}`)}</label>
                </span>
              ))}
            </div>
          </fieldset>
          <FieldGroup>
            <div className="field full"><label className="label" htmlFor={id('title')}>{t('co.pg.f.title')}</label><input id={id('title')} className="input" required maxLength={120} value={f.title} onChange={set('title')} data-testid="co-pg-title" /></div>
            <div className="field full"><label className="label" htmlFor={id('brief')}>{t('co.pg.f.brief')}</label><textarea id={id('brief')} className="input" rows={4} required maxLength={3000} value={f.brief} onChange={set('brief')} data-testid="co-pg-brief" /></div>
            {f.kind === 'project' && <div className="field full"><label className="label" htmlFor={id('deliverable')}>{t('co.pg.f.deliverable')}</label><input id={id('deliverable')} className="input" maxLength={600} value={f.deliverable} onChange={set('deliverable')} data-testid="co-pg-deliverable" /></div>}
          </FieldGroup>
          <FieldGroup>
            {f.kind === 'project' && <div className="field"><label className="label" htmlFor={id('deadline')}>{t('co.pg.f.deadline')}</label><input id={id('deadline')} className="input" type="date" value={f.deadline} onChange={set('deadline')} data-testid="co-pg-deadline" /></div>}
            <div className="field"><label className="label" htmlFor={id('weeks')}>{t('co.pg.f.weeks')}</label><input id={id('weeks')} className="input" inputMode="numeric" value={f.weeks} onChange={set('weeks')} data-testid="co-pg-weeks" /></div>
            <div className="field"><label className="label" htmlFor={id('stipend')}>{t('co.pg.f.stipend')}</label><input id={id('stipend')} className="input" inputMode="numeric" value={f.stipend} onChange={set('stipend')} placeholder="0" data-testid="co-pg-stipend" /></div>
            <div className="field"><label className="label" htmlFor={id('seats')}>{t('co.pg.f.seats')}</label><input id={id('seats')} className="input" inputMode="numeric" value={f.seats} onChange={set('seats')} data-testid="co-pg-seats" /></div>
          </FieldGroup>
          <FieldGroup>
            <span className="cp-toggle full"><input type="checkbox" id={id('remote')} checked={f.remote} onChange={set('remote')} data-testid="co-pg-remote" /><label htmlFor={id('remote')}>{t('co.pg.f.remote')}</label></span>
            {!f.remote && <div className="field"><label className="label" htmlFor={id('city')}>{t('co.pg.f.city')}</label><input id={id('city')} className="input" maxLength={60} value={f.city} onChange={set('city')} data-testid="co-pg-city" /></div>}
          </FieldGroup>
          {err && <p className="error" role="alert">{err}</p>}
          <StickyBar>
            <button type="submit" className="btn btn-signal" disabled={busy} data-testid="co-pg-post">{t('co.pg.post')}</button>
            <button type="button" className="btn btn-outline" onClick={() => setF(null)}>{t('co.pg.cancel')}</button>
          </StickyBar>
        </form>
      )}
      {!f && err && <p className="error" role="alert">{err}</p>}
      {rows === null && <Skel cards={2} />}
      {rows && rows.length === 0 && !f && !err && <Empty compact shape="cap" tint="company" title={t('co.pg.new')} />}
      {rows && rows.length > 0 && <div className="cp-grid">{rows.map((p) => <Program key={p.id} t={t} c={c} p={p} onChange={load} />)}</div>}
    </section>
  );
}
