// Phase 6 S6: after Not selected, the company can pick 1–3 short reasons (optional, encouraged). The person sees them
// in kind words with free practice and courses; never the interviewer's name or who wrote it. English, Telugu and
// Hindi (co.fb.*).
import { useState } from 'react';
import { rq } from '../../lib/company';
import '../../styles/company-signup.css';

const REASONS = ['skills', 'communication', 'experience', 'fit', 'filled', 'other'];

export default function ApplicantFeedback({ t, c, a }) {
  const [given, setGiven] = useState(a.feedback || []);
  const [pick, setPick] = useState([]);
  const [skill, setSkill] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (given.length) return <span className="small fb-done" data-testid="co-fb-done">{t('co.fb.done', { list: given.map((r) => t(`co.fb.r.${r}`)).join(', ') })}</span>;
  const flip = (r) => setPick(pick.includes(r) ? pick.filter((x) => x !== r) : pick.length < 3 ? [...pick, r] : pick);
  const send = async () => {
    if (!pick.length) { setErr(t('co.fb.pick')); return; }
    setBusy(true); setErr('');
    try { const r = await rq(`/api/company/${c.id}/applicants/${a.id}/feedback`, { method: 'POST', body: { reasons: pick, skill: skill.trim(), note: note.trim() } }); setGiven(r.reasons); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <fieldset className="fb-box" data-testid="co-fb">
      <legend className="fb-title">{t('co.fb.title')}</legend>
      <span className="small muted">{t('co.fb.intro')}</span>
      <div className="fb-pills">
        {REASONS.map((r) => <label key={r} className={`fb-pill ${pick.includes(r) ? 'on' : ''}`}><input type="checkbox" checked={pick.includes(r)} onChange={() => flip(r)} data-testid={`co-fb-${r}`} />{t(`co.fb.r.${r}`)}</label>)}
      </div>
      {pick.includes('skills') && <label className="field"><span className="label">{t('co.fb.skill')}</span><input className="input" maxLength={60} value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="SQL" data-testid="co-fb-skill" /></label>}
      <label className="field"><span className="label">{t('co.fb.note')}</span><input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <button type="button" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={send} data-testid="co-fb-send">{t('co.fb.send')}</button>
    </fieldset>
  );
}
