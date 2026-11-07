// Build a resume by talking (Phase 4, E4): /me/simple/resume, one question per screen, answered by voice (🎤, with
// "We heard: …" before saving) or by tapping chips. Progress "4 of 10", Skip and Back on every question, each answer
// saved at once into the person's normal resume (app/simple/guided.py; the full builder shows the same resume).
// Projects and internships: "This is what we wrote" (English resume lines made only from the answers) with
// Accept / Change by voice / Edit. Never asks for ID numbers, caste, religion, gender or a photo.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { http } from '../../services/http';
import { SayButton, SpeakField } from './voice';

const API = '/api/me/simple/resume';
const splitSkills = (s) => String(s || '').split(/,|\band\b|\bమరియు\b|\bऔर\b|\n/).map((x) => x.trim()).filter(Boolean);

function Chips({ options, picked, onToggle, testid }) {
  return (
    <div className="sx-chips">
      {options.map((o) => (
        <button key={o} type="button" className="sx-chipbtn" aria-pressed={picked.includes(o)} onClick={() => onToggle(o)} data-testid={testid ? `${testid}-${o}` : undefined}>
          <span className="sx-chipic" aria-hidden="true">{picked.includes(o) ? '✔' : '+'}</span>{o}
        </button>
      ))}
    </div>
  );
}

/** Projects and internships: three short answers → "This is what we wrote" → Accept / Change by voice / Edit. */
function Wrote({ t, lang, kind, s, onAccepted }) {
  const fields = kind === 'projects' ? ['built', 'tools', 'does'] : ['company', 'role', 'built'];
  const [a, setA] = useState({});
  const [lines, setLines] = useState(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const added = (s.answers?.[kind] || []).length;
  const write = async () => {
    setBusy(true); setNote('');
    try { const r = await http(`${API}/write`, { method: 'POST', body: { kind, answers: a } }); setLines(r.lines); setEditing(false); } catch (e) { setNote(e.message); } finally { setBusy(false); }
  };
  const accept = async () => {
    setBusy(true); setNote('');
    try { onAccepted(await http(`${API}/accept`, { method: 'POST', body: { kind, answers: a, lines } })); setLines(null); setA({}); } catch (e) { setNote(e.message); } finally { setBusy(false); }
  };
  if (lines) {
    return (
      <div className="sx-stack" data-testid="sx-wrote">
        <span className="sx-cardtop"><h2 className="sx-h2">{t('simple.r.wrote.title')}</h2><SayButton items={lines} t={t} lang="en" label={t('simple.voice.readCard')} /></span>
        <p className="sx-hint">{t('simple.r.wrote.only')}</p>
        {editing
          ? <SpeakField id="sx-lines" label={t('simple.r.wrote.edit')} value={lines.join('\n')} onChange={(v) => setLines(v.split('\n'))} t={t} lang={lang} multiline testid="sx-lines" />
          : <ul className="sx-lines" lang="en">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
        <button type="button" className="sx-big sx-ink" disabled={busy} onClick={accept} data-testid="sx-accept"><span className="sx-ic" aria-hidden="true">✔</span><span>{t('simple.r.wrote.accept')}</span></button>
        <button type="button" className="sx-big" disabled={busy} onClick={() => { setLines(null); setTimeout(() => document.getElementById(`sx-${kind}-${fields[0]}`)?.focus(), 0); }} data-testid="sx-change-voice"><span className="sx-ic" aria-hidden="true">🎤</span><span>{t('simple.r.wrote.voice')}</span></button>
        {!editing && <button type="button" className="sx-big" disabled={busy} onClick={() => setEditing(true)} data-testid="sx-edit-lines"><span className="sx-ic" aria-hidden="true">✏️</span><span>{t('simple.r.wrote.edit')}</span></button>}
        {note && <p className="sx-note" role="alert">{note}</p>}
      </div>
    );
  }
  return (
    <div className="sx-stack">
      {added > 0 && <p className="sx-note sx-ok" role="status" data-testid="sx-added">{t('simple.r.wrote.added', { n: added })}</p>}
      {fields.map((f) => <SpeakField key={f} id={`sx-${kind}-${f}`} label={t(`simple.r.q.${kind}.${f}`)} value={a[f] || ''} onChange={(v) => setA({ ...a, [f]: v })} t={t} lang={lang} multiline={f === 'built' || f === 'does'} testid={`sx-${kind}-${f}`} />)}
      <button type="button" className="sx-big sx-ink" disabled={busy || !(a.built || '').trim()} onClick={write} data-testid="sx-write"><span className="sx-ic" aria-hidden="true">✍️</span><span>{busy ? t('simple.r.writing') : t('simple.r.write')}</span></button>
      {note && <p className="sx-note" role="alert">{note}</p>}
    </div>
  );
}

export default function GuidedResume({ t, lang, setSay, onDone }) {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [s, setS] = useState(null);
  const [v, setV] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [work, setWork] = useState(null); // internships: yes / no first
  useEffect(() => { http(API).then(setS, (e) => setErr(e.message)); }, []);
  const steps = s?.steps || [];
  const want = params.get('step');
  const i = s ? Math.max(0, Math.min(steps.length - 1, want && steps.includes(want) ? steps.indexOf(want) : Math.min(s.step, steps.length - 1))) : 0;
  const step = steps[i];
  // the saved answer for this step (or the account's name / email), when the step opens
  useEffect(() => {
    if (!s || !step) return;
    const a = s.answers?.[step] || {};
    setV(step === 'about' ? { name: a.name || s.account.name, phone: a.phone || s.account.phone || '', linkedin: a.linkedin || '' } : { ...a }); // item 15: the account's phone too
    setErr('');
  }, [step, s?.answers]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = step ? `simple.r.q.${step}.title` : 'simple.r.title';
  useEffect(() => { setSay([['simple.r.progress', { n: i + 1, total: steps.length || 10 }], [q]]); }, [q, i]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (n) => setParams(n < steps.length ? { step: steps[n] } : {}, { replace: false });
  const save = async (skip = false) => {
    setBusy(true); setErr('');
    try {
      const next = await http(`${API}/${step}`, { method: 'PUT', body: skip ? { skip: true } : { value: v } });
      setS(next);
      if (i + 1 >= steps.length) { await http(`${API}/done`, { method: 'POST' }); onDone(); nav('/me/simple'); } else go(i + 1);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const toggle = (key, o) => { const cur = v[key] || []; setV({ ...v, [key]: cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o] }); };
  const extraChips = useMemo(() => {
    if (!s) return {};
    return { skills: [...new Set([...(s.chips.skills || []), ...(v.skills || [])])], langs: [...new Set([...(s.chips.langs || []), ...(v.names || [])])] };
  }, [s, v.skills, v.names]);
  if (!s) return <p className="sx-p" role={err ? 'alert' : 'status'}>{err || t('simple.loading')}</p>;

  const field = (key, label, extra = {}) => <SpeakField id={`sx-${step}-${key}`} label={label} value={v[key] ?? ''} onChange={(x) => setV({ ...v, [key]: x })} t={t} lang={lang} testid={`sx-${step}-${key}`} {...extra} />;
  let body;
  if (step === 'about') {
    body = <>{field('name', t('simple.r.q.about.name'), { autoComplete: 'name' })}{field('phone', t('simple.r.q.about.phone'), { inputMode: 'tel', autoComplete: 'tel' })}{field('linkedin', t('simple.r.q.about.linkedin'), { inputMode: 'url' })}<p className="sx-hint">{t('simple.r.q.about.email', { email: s.account.email })}</p></>;
  } else if (step === 'studied') {
    body = <><Chips options={s.chips.degrees} picked={v.degree ? [v.degree] : []} onToggle={(o) => setV({ ...v, degree: v.degree === o ? '' : o })} testid="sx-degree" />{field('field', t('simple.r.q.studied.field'))}</>;
  } else if (step === 'college') {
    body = field('name', t('simple.r.q.college.name'));
  } else if (step === 'year') {
    body = field('year', t('simple.r.q.year.year'), { inputMode: 'numeric' });
  } else if (step === 'marks') {
    body = field('grade', t('simple.r.q.marks.grade'));
  } else if (step === 'skills') {
    body = (
      <>
        <Chips options={extraChips.skills} picked={v.skills || []} onToggle={(o) => toggle('skills', o)} testid="sx-skill" />
        <SpeakField id="sx-skills-say" label={t('simple.r.q.skills.say')} value={v.said || ''} onChange={(x) => setV({ ...v, said: x })} t={t} lang={lang} testid="sx-skills-say" />
        {v.said && <button type="button" className="sx-big" onClick={() => setV({ ...v, skills: [...new Set([...(v.skills || []), ...splitSkills(v.said)])], said: '' })} data-testid="sx-skills-add"><span className="sx-ic" aria-hidden="true">➕</span><span>{t('simple.r.q.skills.add')}</span></button>}
      </>
    );
  } else if (step === 'projects') {
    body = <Wrote t={t} lang={lang} kind="projects" s={s} onAccepted={setS} />;
  } else if (step === 'work') {
    body = work === null && !(s.answers?.work || []).length
      ? <div className="sx-stack"><button type="button" className="sx-big" onClick={() => setWork(true)} data-testid="sx-work-yes"><span className="sx-ic" aria-hidden="true">👍</span><span>{t('simple.r.q.work.yes')}</span></button><button type="button" className="sx-big" onClick={() => save(true)} data-testid="sx-work-no"><span className="sx-ic" aria-hidden="true">✋</span><span>{t('simple.r.q.work.no')}</span></button></div>
      : <Wrote t={t} lang={lang} kind="work" s={s} onAccepted={setS} />;
  } else if (step === 'certs') {
    body = <>{s.wallet.length ? <Chips options={s.wallet} picked={v.names || []} onToggle={(o) => toggle('names', o)} testid="sx-cert" /> : <p className="sx-hint">{t('simple.r.q.certs.none')}</p>}{field('other', t('simple.r.q.certs.other'))}</>;
  } else if (step === 'langs') {
    body = <><Chips options={extraChips.langs} picked={v.names || []} onToggle={(o) => toggle('names', o)} testid="sx-lang" />{field('other', t('simple.r.q.langs.other'))}</>;
  }
  const value = () => {
    if ((step === 'certs' || step === 'langs') && (v.other || '').trim()) return { ...v, names: [...(v.names || []), ...splitSkills(v.other)] };
    return v;
  };
  const next = async () => {
    if (step === 'projects' || step === 'work') return save(true); // added on Accept; Next moves on
    setV(value());
    setBusy(true); setErr('');
    try {
      const out = await http(`${API}/${step}`, { method: 'PUT', body: { value: value() } });
      setS(out);
      if (i + 1 >= steps.length) { await http(`${API}/done`, { method: 'POST' }); onDone(); nav('/me/simple'); } else go(i + 1);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <section className="sx-stack" aria-labelledby="sx-q" data-testid="sx-guided" data-step={step}>
      <div className="sx-stack" style={{ gap: 6 }}>
        <span className="sx-label" data-testid="sx-progress">{t('simple.r.progress', { n: i + 1, total: steps.length })}</span>
        <div className="sx-bar" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={i + 1} aria-label={t('simple.r.progress', { n: i + 1, total: steps.length })}><span style={{ width: `${((i + 1) / steps.length) * 100}%` }} /></div>
      </div>
      <h1 id="sx-q" className="sx-h1">{t(q)}</h1>
      {body}
      {err && <p className="sx-note" role="alert" data-testid="sx-error">{err}</p>}
      <div className="sx-navrow">
        <button type="button" className="sx-big" onClick={() => (i > 0 ? go(i - 1) : nav('/me/simple'))} data-testid="sx-back"><span className="sx-ic" aria-hidden="true">←</span><span>{t('simple.r.back')}</span></button>
        <button type="button" className="sx-big" disabled={busy} onClick={() => save(true)} data-testid="sx-skip"><span>{t('simple.r.skip')}</span></button>
        <button type="button" className="sx-big sx-ink" disabled={busy} onClick={next} data-testid="sx-next-q"><span>{i + 1 >= steps.length ? t('simple.r.finish') : t('simple.r.next')}</span><span className="sx-ic" aria-hidden="true">→</span></button>
      </div>
    </section>
  );
}
