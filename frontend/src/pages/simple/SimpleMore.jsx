// More simple screens (fix round, 7 Nov: items 3, 4, 5, 12), so every tile and button stays inside the easy dashboard:
//   /me/simple/myresume   what is on the resume, in plain words, with Download PDF and "Change my answers"
//   /me/simple/apps       My applications as big cards (no board, no chart)
//   /me/simple/practice   interview practice: common questions one at a time (voice or typing), and the practice
//                         for each job the person matched
//   /me/simple/fixes      the resume score's fixes in plain words, each one button to the exact place
import { useEffect, useState } from 'react';
import { http } from '../../services/http';
import { Big, WaitNote } from './SimpleApp';
import { useScreen } from '../../lib/simple';
import { SayButton, SpeakField } from './voice';

const useGet = (path) => useScreen(path); // the last data at once, then fresh (re-test N6)
export const Wait = ({ t, err }) => <WaitNote t={t} err={err} />;
const list = (v) => (Array.isArray(v) ? v : []);
const lines = (s) => String(s || '').split('\n').map((x) => x.replace(/^[•\-*–▸ ]+/, '').trim()).filter(Boolean);

/** The resume's parts in plain words (what the student told us, the same resume the full builder opens). */
export function resumeParts(d) {
  const p = d?.personal || {};
  const edu = list(d?.edu)[0] || {};
  const skills = list(d?.skillGroups).flatMap((g) => String(g.value || '').split(',')).map((x) => x.trim()).filter(Boolean);
  return {
    name: p.name || '',
    contact: [p.email, p.phone].filter(Boolean).join(' · '),
    studied: [[edu.degree, edu.field].filter(Boolean).join(' '), edu.institution, edu.to].filter(Boolean).join(' · '),
    skills,
    projects: list(d?.proj).filter((x) => x.title).map((x) => ({ title: x.title, lines: lines(x.description) })),
    work: list(d?.exp).filter((x) => x.role || x.company).map((x) => ({ title: [x.role, x.company].filter(Boolean).join(' · '), lines: lines(x.description) })),
    certs: list(d?.certs).map((c) => c.name).filter(Boolean),
    langs: list(d?.langs).map((x) => x.name).filter(Boolean),
  };
}

function Part({ title, children, testid }) {
  return <section className="sx-next" data-testid={testid}><h2 className="sx-h2">{title}</h2>{children}</section>;
}

export function MyResume({ t, setSay }) {
  const [rs, err] = useGet('/api/me/resumes');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const r = rs && (rs.find((x) => x.active) || rs[0]);
  const parts = r ? resumeParts(r.data) : null;
  useEffect(() => { setSay([['simple.mr.title'], parts?.name || '']); }, [parts?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rs) return <Wait t={t} err={err} />;
  if (!r) return <div className="sx-stack"><p className="sx-p">{t('simple.mr.none')}</p><Big to="/me/simple/resume" icon="📝" label={t('simple.next.resume.cta')} ink /></div>;
  const pdf = async () => {
    setBusy(true); setNote('');
    try {
      const { downloadResume } = await import('../me/shared'); // the PDF tools load only now (they are big)
      if (await downloadResume(r.data, 'pdf', undefined, undefined, r.id)) setNote(t('simple.mr.ready'));
    } catch (e) { setNote(e.message || t('simple.error')); } finally { setBusy(false); }
  };
  const row = (items) => (items.length ? <ul className="sx-ul">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="sx-hint">{t('simple.mr.empty')}</p>);
  return (
    <section className="sx-stack" aria-labelledby="sx-mr-h" data-testid="sx-myresume">
      <h1 id="sx-mr-h" className="sx-h1">{t('simple.mr.title')}</h1>
      <button type="button" className="sx-big sx-ink" disabled={busy} onClick={pdf} data-testid="sx-pdf"><span className="sx-ic" aria-hidden="true">⬇️</span><span>{busy ? t('simple.loading') : t('simple.mr.pdf')}</span></button>
      {note && <p className="sx-note" role="status" data-testid="sx-pdf-note">{note}</p>}
      <Part title={t('simple.mr.about')} testid="sx-mr-about"><p className="sx-p"><strong>{parts.name || '—'}</strong></p><p className="sx-p">{parts.contact || t('simple.mr.empty')}</p></Part>
      <Part title={t('simple.mr.studied')}><p className="sx-p">{parts.studied || t('simple.mr.empty')}</p></Part>
      <Part title={t('simple.mr.skills')}>{row(parts.skills)}</Part>
      <Part title={t('simple.mr.projects')} testid="sx-mr-projects">{parts.projects.length ? parts.projects.map((x) => <div key={x.title} className="sx-stack" style={{ gap: 4 }}><strong className="sx-p">{x.title}</strong>{row(x.lines)}</div>) : <p className="sx-hint">{t('simple.mr.empty')}</p>}</Part>
      {parts.work.length > 0 && <Part title={t('simple.mr.work')}>{parts.work.map((x) => <div key={x.title} className="sx-stack" style={{ gap: 4 }}><strong className="sx-p">{x.title}</strong>{row(x.lines)}</div>)}</Part>}
      <Part title={t('simple.mr.certs')}>{row(parts.certs)}</Part>
      <Part title={t('simple.mr.langs')}>{row(parts.langs)}</Part>
      <Big to="/me/simple/resume?step=about" icon="✏️" label={t('simple.mr.change')} testid="sx-mr-change" />
      <Big to="/me/simple" icon="←" label={t('simple.back')} />
    </section>
  );
}

const STATUS_ICON = { saved: '☆', applied: '📨', viewed: '👀', shortlisted: '⭐', interview: '🎤', offer: '🎉', rejected: '✖', no_reply: '⏳' };

export function Apps({ t, setSay }) {
  const [st, err] = useGet('/api/me/state');
  const apps = st ? [...list(st.apps)].sort((a, b) => (b.date || 0) - (a.date || 0)) : [];
  useEffect(() => { setSay([['simple.ap.title'], ['simple.ap.count', { n: apps.length }]]); }, [apps.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st) return <Wait t={t} err={err} />;
  return (
    <section className="sx-stack" aria-labelledby="sx-ap-h" data-testid="sx-apps">
      <h1 id="sx-ap-h" className="sx-h1">{t('simple.ap.title')}</h1>
      {apps.length === 0 && <><p className="sx-p">{t('simple.ap.none')}</p><Big to="/me/simple/jobs" icon="💼" label={t('simple.next.jobs.cta')} ink /></>}
      <ul className="sx-list">
        {apps.map((a) => (
          <li key={a.id} className="sx-next" data-testid="sx-app">
            <span className="sx-cardtop"><span className="sx-match">{STATUS_ICON[a.status] || '•'} {t(`simple.ap.status.${a.status}`)}</span><SayButton items={[a.role, a.company, [`simple.ap.status.${a.status}`]]} t={t} lang="en" label={t('simple.voice.readCard')} /></span>
            <h2 className="sx-h2">{a.role || '—'}</h2>
            <p className="sx-p"><strong>{a.company}</strong></p>
            {a.date ? <p className="sx-hint">{t('simple.ap.when', { date: new Date(a.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) })}</p> : null}
          </li>
        ))}
      </ul>
      <Big to="/me/simple" icon="←" label={t('simple.back')} />
    </section>
  );
}

export const COMMON = ['q1', 'q2', 'q3', 'q4', 'q5'];

/** The clarity feedback on one answer, in plain words, with Read aloud (re-test N1): the same checks as the full
 * practice mode. */
function Feedback({ fb, t, lang }) {
  const rows = [['simple.pr.fb.structure', fb.structure], ['simple.pr.fb.length', fb.length], ['simple.pr.fb.filler', fb.filler], ['simple.pr.fb.result', fb.result]].filter(([, v]) => v);
  return (
    <div className="sx-next" data-testid="sx-pr-feedback" aria-live="polite">
      <span className="sx-cardtop"><h2 className="sx-h2">{t('simple.pr.fb.title')}</h2><SayButton items={[['simple.pr.fb.title'], ...rows.map(([, v]) => v), ['simple.pr.fb.better'], fb.better]} t={t} lang={lang} label={t('simple.voice.readCard')} testid="sx-pr-fb-say" /></span>
      <ul className="sx-ul">{rows.map(([k, v]) => <li key={k} data-testid={`sx-pr-fb-${k.split('.').pop()}`}><strong>{t(k)}:</strong> {v}</li>)}</ul>
      {fb.better && <><span className="sx-label">{t('simple.pr.fb.better')}</span><p className="sx-p" lang="en" data-testid="sx-pr-better">{fb.better}</p></>}
    </div>
  );
}

export function Practice({ t, lang, setSay }) {
  const [matches] = useGet('/api/me/jobs/matches');
  const [i, setI] = useState(-1); // -1: the list; 0-4: a common question
  const [answer, setAnswer] = useState('');
  const [fb, setFb] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => { setSay(i < 0 ? [['simple.pr.title'], ['simple.pr.text']] : [[`simple.pr.${COMMON[i]}`], [`simple.pr.${COMMON[i]}tip`]]); setAnswer(''); setFb(null); setErr(''); }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = () => { if (i + 1 < COMMON.length) setI(i + 1); else { setDone(true); setI(-1); } };
  const check = async () => {
    setBusy(true); setErr('');
    try { setFb((await http('/api/me/simple/practice', { method: 'POST', body: { q: COMMON[i], answer: answer.trim() } })).feedback); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  if (i >= 0) {
    const q = COMMON[i];
    return (
      <section className="sx-stack" aria-labelledby="sx-pr-q" data-testid="sx-practice-q">
        <span className="sx-label">{t('simple.r.progress', { n: i + 1, total: COMMON.length })}</span>
        <span className="sx-cardtop"><h1 id="sx-pr-q" className="sx-h1">{t(`simple.pr.${q}`)}</h1><SayButton items={[[`simple.pr.${q}`]]} t={t} lang={lang} label={t('simple.voice.readCard')} /></span>
        <p className="sx-note">{t(`simple.pr.${q}tip`)}</p>
        <SpeakField id="sx-pr-answer" label={t('simple.pr.yours')} value={answer} onChange={(v) => { setAnswer(v); setFb(null); }} t={t} lang={lang} multiline testid="sx-pr-answer" />
        <p className="sx-hint">{t('simple.pr.private')}</p>
        {err && <p className="sx-note" role="alert">{err}</p>}
        {fb && <Feedback fb={fb} t={t} lang={lang} />}
        <div className="sx-navrow">
          <button type="button" className="sx-big" onClick={() => setI(i - 1)}><span className="sx-ic" aria-hidden="true">←</span><span>{t('simple.r.back')}</span></button>
          {/* first "How did I do?", then Next: feedback after every answer (N1); an empty answer can be skipped */}
          {answer.trim() && !fb
            ? <button type="button" className="sx-big sx-ink" disabled={busy} onClick={check} data-testid="sx-pr-check"><span>{busy ? t('simple.loading') : t('simple.pr.check')}</span><span className="sx-ic" aria-hidden="true">✓</span></button>
            : <button type="button" className="sx-big sx-ink" onClick={next} data-testid="sx-pr-next"><span>{i + 1 < COMMON.length ? t('simple.r.next') : t('simple.r.finish')}</span><span className="sx-ic" aria-hidden="true">→</span></button>}
        </div>
      </section>
    );
  }
  const mine = list(matches).slice(0, 5);
  return (
    <section className="sx-stack" aria-labelledby="sx-pr-h" data-testid="sx-practice">
      <h1 id="sx-pr-h" className="sx-h1">{t('simple.pr.title')}</h1>
      <p className="sx-p">{t('simple.pr.text')}</p>
      {done && <p className="sx-note sx-ok" role="status" data-testid="sx-pr-done">{t('simple.pr.done')}</p>}
      <Big icon="🎤" label={t('simple.pr.common')} ink onClick={() => { setDone(false); setI(0); }} testid="sx-pr-common" />
      {mine.length > 0 && <h2 className="sx-h2">{t('simple.pr.forJobs')}</h2>}
      <ul className="sx-list">{mine.map((m) => <li key={m.id}><Big to={`/me/interview/${m.id}`} icon="💼" label={t('simple.pr.forJob', { title: m.title || m.company || '—' })} testid="sx-pr-job" /></li>)}</ul>
      <Big to="/me/simple" icon="←" label={t('simple.back')} />
    </section>
  );
}

/** Fixes that have a simple screen of their own; the rest open the builder at the exact section. */
export const SIMPLE_FIX = {
  contact: '/me/simple/resume?step=about', linkedin: '/me/simple/resume?step=about', skills: '/me/simple/resume?step=skills',
  experience: '/me/simple/resume?step=projects', education: '/me/simple/resume?step=studied',
};
const FIX_KEYS = ['contact', 'linkedin', 'summary', 'experience', 'numbers', 'verbs', 'skills', 'education', 'layout', 'length', 'resume'];

export function Fixes({ t, setSay }) {
  const [d, err] = useGet('/api/me/auto-apply');
  const g = d?.gate;
  useEffect(() => { if (g) setSay([g.score == null ? ['simple.fx.noResume'] : ['simple.fx.score', { score: g.score, need: g.need }], ...g.fixes.map((f) => [`simple.fix.${FIX_KEYS.includes(f.key) ? f.key : 'other'}`])]); }, [g?.score]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Wait t={t} err={err} />;
  return (
    <section className="sx-stack" aria-labelledby="sx-fx-h" data-testid="sx-fixes">
      <h1 id="sx-fx-h" className="sx-h1">{t('simple.fx.title')}</h1>
      <p className="sx-p" data-testid="sx-fx-score">{g.score == null ? t('simple.fx.noResume') : t(g.ok ? 'simple.fx.good' : 'simple.fx.score', { score: g.score, need: g.need })}</p>
      <ul className="sx-list">
        {g.fixes.map((f) => {
          const to = SIMPLE_FIX[f.key] || (f.key === 'resume' ? '/me/simple/resume' : f.path);
          return (
            <li key={f.key} className="sx-next" data-testid="sx-fix" data-key={f.key}>
              <p className="sx-p">{t(`simple.fix.${FIX_KEYS.includes(f.key) ? f.key : 'other'}`)}</p>
              <Big to={to} icon="➜" label={t('simple.fx.fix')} ink testid={`sx-fix-${f.key}`} />
              {!SIMPLE_FIX[f.key] && f.key !== 'resume' && <span className="sx-hint">{t('simple.fx.builder')}</span>}
            </li>
          );
        })}
      </ul>
      <Big to="/me/simple" icon="←" label={t('simple.back')} />
    </section>
  );
}
