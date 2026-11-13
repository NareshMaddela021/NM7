// Phase 6 S8: internships and 1–4 week live projects (Verified companies). Post one; accept up to the places you
// set; review the work students send; a completed one gets a certificate with a verification link. Unpaid is
// allowed and shown as "Unpaid"; work that looks like free labour is checked by Nm7 before students see it.
// English, Telugu and Hindi (co.pg.*).
import { useEffect, useState } from 'react';
import { rq } from '../../lib/company';

const BLANK = { kind: 'project', title: '', brief: '', deliverable: '', deadline: '', weeks: '2', stipend: '', remote: true, city: '', seats: '5' };

function Applicant({ t, c, p, a, onChange }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const go = async (path, body) => {
    setBusy(true); setErr('');
    try { await rq(`/api/company/${c.id}/programs/${p.id}/applicants/${a.id}/${path}`, { method: 'POST', body }); onChange(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <li className="card-sm stack g4" data-testid="co-pg-app">
      <div className="row between g8" style={{ flexWrap: 'wrap' }}><strong className="small">{a.name}</strong><span className="badge b-neutral">{t(`co.pg.st.${a.status}`)}</span></div>
      {a.note && <span className="xs muted">{a.note}</span>}
      {a.status === 'applied' && <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => go('accept')} data-testid="co-pg-accept">{t('co.pg.accept')}</button>}
      {a.status === 'submitted' && (
        <div className="stack g4">
          {a.submission.link ? <a className="small" href={a.submission.link} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere' }}>{a.submission.link}</a> : <span className="small" style={{ overflowWrap: 'anywhere' }}>{a.submission.text}</span>}
          <input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('co.pg.reviewNote')} aria-label={t('co.pg.reviewNote')} />
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ink btn-sm" disabled={busy} onClick={() => go('review', { ok: true, note })} data-testid="co-pg-pass">{t('co.pg.pass')}</button>
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => go('review', { ok: false, note })}>{t('co.pg.fail')}</button>
          </div>
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </li>
  );
}

export default function CompanyPrograms({ t, c }) {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = () => rq(`/api/company/${c.id}/programs`).then(setRows, (x) => { setErr(x.message); setRows([]); });
  useEffect(() => { load(); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (c.trust !== 'verified') return <section className="card stack g8" data-testid="co-pg"><strong>{t('co.pg.title')}</strong><p className="small">{t('co.pg.basic')}</p></section>;
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
    <section className="stack g12" aria-label={t('co.pg.title')} data-testid="co-pg">
      <div className="card stack g8">
        <strong>{t('co.pg.title')}</strong>
        <span className="small muted">{t('co.pg.intro')}</span>
        {!f && <button type="button" className="btn btn-ink btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setF({ ...BLANK })} data-testid="co-pg-new">{t('co.pg.new')}</button>}
      </div>
      {f && (
        <form className="card stack g8" onSubmit={post} data-testid="co-pg-form">
          <div className="row g12" style={{ flexWrap: 'wrap' }}>{['project', 'internship'].map((k) => <label key={k} className="row g4 small"><input type="radio" name="co-pg-kind" checked={f.kind === k} onChange={() => setF({ ...f, kind: k, weeks: k === 'project' ? '2' : '8' })} />{t(`co.pg.kind.${k}`)}</label>)}</div>
          <label className="field"><span className="label">{t('co.pg.f.title')}</span><input className="input" required maxLength={120} value={f.title} onChange={set('title')} data-testid="co-pg-title" /></label>
          <label className="field"><span className="label">{t('co.pg.f.brief')}</span><textarea className="input" rows={3} required maxLength={3000} value={f.brief} onChange={set('brief')} data-testid="co-pg-brief" /></label>
          {f.kind === 'project' && <label className="field"><span className="label">{t('co.pg.f.deliverable')}</span><input className="input" maxLength={600} value={f.deliverable} onChange={set('deliverable')} data-testid="co-pg-deliverable" /></label>}
          <div className="co-grid">
            {f.kind === 'project' && <label className="field"><span className="label">{t('co.pg.f.deadline')}</span><input className="input" type="date" value={f.deadline} onChange={set('deadline')} data-testid="co-pg-deadline" /></label>}
            <label className="field"><span className="label">{t('co.pg.f.weeks')}</span><input className="input" inputMode="numeric" value={f.weeks} onChange={set('weeks')} data-testid="co-pg-weeks" /></label>
            <label className="field"><span className="label">{t('co.pg.f.stipend')}</span><input className="input" inputMode="numeric" value={f.stipend} onChange={set('stipend')} placeholder="0" /></label>
            <label className="field"><span className="label">{t('co.pg.f.seats')}</span><input className="input" inputMode="numeric" value={f.seats} onChange={set('seats')} data-testid="co-pg-seats" /></label>
          </div>
          <label className="row g8 small"><input type="checkbox" checked={f.remote} onChange={set('remote')} />{t('co.pg.f.remote')}</label>
          {!f.remote && <label className="field"><span className="label">{t('co.pg.f.city')}</span><input className="input" maxLength={60} value={f.city} onChange={set('city')} /></label>}
          {err && <p className="error" role="alert">{err}</p>}
          <div className="row g8"><button type="submit" className="btn btn-ink btn-sm" disabled={busy} data-testid="co-pg-post">{t('co.pg.post')}</button><button type="button" className="btn btn-outline btn-sm" onClick={() => setF(null)}>{t('co.pg.cancel')}</button></div>
        </form>
      )}
      {!f && err && <p className="error" role="alert">{err}</p>}
      {(rows || []).map((p) => (
        <section key={p.id} className="card stack g8" data-testid="co-pg-row">
          <div className="row between g8" style={{ flexWrap: 'wrap' }}>
            <strong>{p.title}</strong>
            <span className="badge b-neutral" data-testid="co-pg-status">{t(`co.pg.status.${p.status}`)}</span>
          </div>
          <span className="xs muted">{t(`co.pg.kind.${p.kind}`)} · {p.stipend ? `₹${p.stipend.toLocaleString('en-IN')}` : t('co.pg.unpaid')} · {t('co.pg.places', { n: p.accepted, of: p.seats })}</span>
          {p.flags.length > 0 && <span className="small" data-testid="co-pg-flags">{t('co.pg.held')}: {p.flags.join('; ')}</span>}
          <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{p.applicants.map((a) => <Applicant key={a.id} t={t} c={c} p={p} a={a} onChange={load} />)}</ul>
        </section>
      ))}
    </section>
  );
}
