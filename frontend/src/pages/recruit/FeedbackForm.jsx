// Recruiter feedback to the college (R4): a one-minute form after a drive — overall rating, common gaps (skills,
// "basics of <skill>", projects without results, communication, anything else), what went well, would visit again.
// About the drive as a whole: the college never shows it to students, and it names no student.
import { useEffect, useState } from 'react';
import { Dialog, Spinner } from '../../components/ui';

const VISIT = [['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'No']];
const EMPTY = { rating: 0, skills: [], basics: [], projectsNoResults: false, communication: false, other: '', wentWell: '', visitAgain: '' };

/** load(): {company, orgName, feedback, options}; save(body): the same, saved. */
export default function FeedbackForm({ load, save, onClose, onSaved }) {
  const [st, setSt] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [basic, setBasic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    load().then((d) => { setSt(d); if (d.feedback) setForm({ ...EMPTY, ...d.feedback }); }, (e) => setError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (k, s) => set(k, form[k].includes(s) ? form[k].filter((x) => x !== s) : [...form[k], s]);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    const { rating, skills, basics, projectsNoResults, communication, other, wentWell, visitAgain } = form;
    try { await save({ rating, skills, basics, projectsNoResults, communication, other, wentWell, visitAgain }); onSaved?.(); onClose(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Dialog showTitle title={st ? `Feedback for ${st.orgName}` : 'Feedback for the college'} onClose={onClose}>
      {!st ? (error ? <p className="error" role="alert">{error}</p> : <div className="row g8 muted" role="status"><Spinner /> Loading…</div>) : (
        <form className="stack g16" onSubmit={submit} aria-label="Feedback for the college">
          <p className="xs muted">About the drive as a whole ({st.company}). The college sees it; students don’t, and it never names a student.</p>
          <fieldset className="stack g6" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Overall, how was the drive?</legend>
            <div className="row g6" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={form.rating === n} aria-label={`${n} out of 5`} className={`btn ${form.rating === n ? 'btn-ink' : 'btn-outline'}`} style={{ minWidth: 44 }} onClick={() => set('rating', n)}>{n}</button>
              ))}
            </div>
            <span className="xs faint">1 poor · 5 excellent</span>
          </fieldset>
          <fieldset className="stack g6" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Common gaps you noticed</legend>
            <div className="row g6" style={{ flexWrap: 'wrap' }}>
              {st.options.map((s) => (
                <label key={s} className={`chip xs ${form.skills.includes(s) ? 'chip-on' : ''}`} style={{ cursor: 'pointer' }}><input type="checkbox" checked={form.skills.includes(s)} onChange={() => toggle('skills', s)} style={{ marginRight: 4 }} />{s}</label>
              ))}
            </div>
            <label className="row g8 small"><input type="checkbox" checked={form.projectsNoResults} onChange={(e) => set('projectsNoResults', e.target.checked)} /> Projects without results (no numbers or outcomes)</label>
            <label className="row g8 small"><input type="checkbox" checked={form.communication} onChange={(e) => set('communication', e.target.checked)} /> Communication</label>
            <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: '1 1 180px' }}><label className="label" htmlFor="fb-basics">Basics of…</label>
                <select id="fb-basics" className="input" value={basic} onChange={(e) => setBasic(e.target.value)}><option value="">Choose a skill</option>{st.options.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
              <button type="button" className="btn btn-outline" disabled={!basic || form.basics.includes(basic) || form.basics.length >= 10} onClick={() => { set('basics', [...form.basics, basic]); setBasic(''); }}>Add</button>
            </div>
            {form.basics.length > 0 && <div className="row g6" style={{ flexWrap: 'wrap' }}>{form.basics.map((s) => <button key={s} type="button" className="chip xs" aria-label={`Remove basics of ${s}`} onClick={() => toggle('basics', s)}>Basics of {s} ✕</button>)}</div>}
            <div className="field"><label className="label" htmlFor="fb-other">Anything else (optional)</label><input id="fb-other" className="input" maxLength={300} value={form.other} onChange={(e) => set('other', e.target.value)} /></div>
          </fieldset>
          <div className="field"><label className="label" htmlFor="fb-well">What went well (optional)</label><textarea id="fb-well" className="input" rows={2} maxLength={500} value={form.wentWell} onChange={(e) => set('wentWell', e.target.value)} /></div>
          <fieldset className="stack g6" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Would you visit again?</legend>
            <div className="row g12">{VISIT.map(([v, l]) => <label key={v} className="row g6 small"><input type="radio" name="fb-visit" checked={form.visitAgain === v} onChange={() => set('visitAgain', v)} /> {l}</label>)}</div>
          </fieldset>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy || !form.rating || !form.visitAgain}>{busy ? 'Saving…' : 'Send feedback'}</button>
        </form>
      )}
    </Dialog>
  );
}
