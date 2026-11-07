// Jobs made simple (Phase 4, E6), all on the Easy dashboard, all read aloud with 🔊:
//   /me/simple/jobs            the top 3 jobs as big cards: title, match % with one plain reason, place, ₹ a month,
//                              the company's trust badge; Apply and Save
//   /me/simple/jobs/:id        Apply: the normal Manual Apply (consent tick and the company's questions for jobs on
//                              Nm7; the company's own site opens for the others, and it is saved in My applications)
//   /me/simple/auto            "Let Nm7 apply for me": role, city, how many a day and the consent tick; the
//                              resume-score gate still applies (the normal Auto Apply settings)
//   /me/simple/answers         "Needs your answer": one question per screen, by voice or tap
//   /me/simple/outside         "Apply on their website" (Ready to apply) as big cards
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { http } from '../../services/http';
import { Big } from './SimpleApp';
import { SayButton, SpeakField } from './voice';

const money = (n) => Number(n).toLocaleString('en-IN');
const TRUST = { verified: '✔', basic: '✉', unverified: '•' };

export function salaryKey(s) {
  if (!s) return ['simple.j.noSalary'];
  if (s.min != null && s.max != null && s.min !== s.max) return ['simple.j.salary', { min: money(s.min), max: money(s.max) }];
  if (s.min != null) return ['simple.j.salaryFrom', { min: money(s.min) }];
  return ['simple.j.salaryUpTo', { max: money(s.max) }];
}
const placeKey = (j) => (j.place === 'remote' ? ['simple.j.remote'] : ['simple.j.place', { place: j.place || '—' }]);
export const cardWords = (j) => [j.title, j.company, ['simple.j.match', { n: j.match }], [`simple.j.reason.${j.reason.key}`, j.reason.vars], placeKey(j), salaryKey(j.salaryMonth)];

function useJobs() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = () => http('/api/me/simple/jobs').then(setD, (e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  return { d, err, load, setD };
}

function JobCard({ t, lang, j, onSave }) {
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await http(`/api/me/saved-jobs/${j.id}`, { method: j.saved ? 'DELETE' : 'PUT' }); onSave(!j.saved); } catch { /* stays as it was */ } finally { setBusy(false); }
  };
  return (
    <article className="sx-next sx-job" aria-labelledby={`sx-j-${j.id}`} data-testid="sx-job">
      <span className="sx-cardtop">
        <span className="sx-match" data-testid="sx-job-match">{t('simple.j.match', { n: j.match })}</span>
        <SayButton items={cardWords(j)} t={t} lang={lang} label={t('simple.voice.readCard')} testid="sx-job-say" />
      </span>
      <h2 id={`sx-j-${j.id}`} className="sx-h2">{j.title}</h2>
      <p className="sx-p"><strong>{j.company}</strong>{j.trust && <span className={`sx-trust sx-trust-${j.trust.level}`} data-testid="sx-job-trust"> <span aria-hidden="true">{TRUST[j.trust.level]}</span> {t(`simple.j.trust.${j.trust.level}`)}</span>}</p>
      <p className="sx-p" data-testid="sx-job-reason">👍 {t(`simple.j.reason.${j.reason.key}`, j.reason.vars)}</p>
      <p className="sx-p">📍 {t(...placeKey(j))}</p>
      <p className="sx-p" data-testid="sx-job-salary">💰 {t(...salaryKey(j.salaryMonth))}</p>
      <div className="sx-frow">
        <Big to={`/me/simple/jobs/${j.id}`} icon="✉️" label={t('simple.j.apply')} ink testid="sx-job-apply" />
        <button type="button" className="sx-big" aria-pressed={j.saved} disabled={busy} onClick={save} data-testid="sx-job-save"><span className="sx-ic" aria-hidden="true">{j.saved ? '★' : '☆'}</span><span>{j.saved ? t('simple.j.saved') : t('simple.j.save')}</span></button>
      </div>
    </article>
  );
}

export function Jobs({ t, lang, setSay }) {
  const { d, err, setD } = useJobs();
  useEffect(() => { if (d) setSay([['simple.j.title'], ...(d.items[0] ? cardWords(d.items[0]) : [['simple.j.none']])]); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <p className="sx-p" role={err ? 'alert' : 'status'}>{err || t('simple.loading')}</p>;
  return (
    <section className="sx-stack" aria-labelledby="sx-jobs-h">
      <h1 id="sx-jobs-h" className="sx-h1">{t('simple.j.title')}</h1>
      {d.needs > 0 && <Big to="/me/simple/answers" icon="💬" label={t('simple.j.answers', { n: d.needs })} ink testid="sx-to-answers" />}
      {d.state === 'no_resume'
        ? <><p className="sx-p">{t('simple.j.noResume')}</p><Big to="/me/simple/resume" icon="📝" label={t('simple.next.resume.cta')} ink /></>
        : d.items.length === 0 ? <p className="sx-p">{t('simple.j.none')}</p>
          : d.items.map((j) => <JobCard key={j.id} t={t} lang={lang} j={j} onSave={(saved) => setD({ ...d, items: d.items.map((x) => (x.id === j.id ? { ...x, saved } : x)) })} />)}
      {d.siteAutoOn && !d.autoOn && <Big to="/me/simple/auto" icon="🤖" label={t('simple.j.letNm7')} testid="sx-let-nm7" />}
      {d.autoOn && <p className="sx-note sx-ok" role="status">{t('simple.j.autoIsOn')}</p>}
      {d.ready > 0 && <Big to="/me/simple/outside" icon="🌐" label={t('simple.j.outside', { n: d.ready })} testid="sx-to-outside" />}
      <Big to="/me/simple" icon="←" label={t('simple.back')} />
    </section>
  );
}

function Question({ t, lang, q, value, onChange }) {
  if (q.kind === 'yesno') {
    return (
      <div className="sx-stack" role="group" aria-label={q.text}>
        <span className="sx-flabel">{q.text}</span>
        <div className="sx-chips">{['yes', 'no'].map((o) => <button key={o} type="button" className="sx-chipbtn" aria-pressed={value === o} onClick={() => onChange(o)} data-testid={`sx-q-${q.id}-${o}`}>{t(`simple.j.${o}`)}</button>)}</div>
      </div>
    );
  }
  if (q.kind === 'choice') {
    return (
      <div className="sx-stack" role="group" aria-label={q.text}>
        <span className="sx-flabel">{q.text}</span>
        <div className="sx-chips">{q.options.map((o) => <button key={o} type="button" className="sx-chipbtn" aria-pressed={value === o} onClick={() => onChange(o)}>{o}</button>)}</div>
      </div>
    );
  }
  return <SpeakField id={`sx-q-${q.id}`} label={q.text} value={value == null ? '' : String(value)} onChange={(v) => onChange(v.replace(/[^\d]/g, ''))} t={t} lang={lang} inputMode="numeric" testid={`sx-q-${q.id}`} />;
}

export function Apply({ t, lang, setSay }) {
  const { id } = useParams();
  const { d, err } = useJobs();
  const [consent, setConsent] = useState(false);
  const [answers, setAnswers] = useState({});
  const [done, setDone] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const j = d?.items.find((x) => x.id === id);
  useEffect(() => { if (j) setSay([['simple.j.applyTitle', { title: j.title }], ...(j.method === 'nm7' ? [['simple.j.consent', { company: j.company }]] : [['simple.j.onTheirSite']])]); }, [j?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <p className="sx-p" role={err ? 'alert' : 'status'}>{err || t('simple.loading')}</p>;
  if (!j) return <div className="sx-stack"><p className="sx-p">{t('simple.j.gone')}</p><Big to="/me/simple/jobs" icon="←" label={t('simple.back')} /></div>;
  const send = async () => {
    setBusy(true); setNote('');
    const win = j.method === 'link' ? window.open('', '_blank') : null; // opened on the tap itself, so phones allow it
    try {
      const r = await http(`/api/jobs/${j.id}/apply`, { method: 'POST', body: j.method === 'nm7' ? { consent, answers } : {} });
      if (j.method === 'link' && r.url) { if (win) { win.opener = null; win.location.href = r.url; } else window.open(r.url, '_blank', 'noopener'); }
      setDone(r);
    } catch (e) { win?.close(); setNote(e.message); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <section className="sx-stack" data-testid="sx-applied">
        <h1 className="sx-h1"><span aria-hidden="true">✅ </span>{t('simple.j.done')}</h1>
        <p className="sx-p">{t(done.method === 'link' ? 'simple.j.doneLink' : 'simple.j.doneSaved')}</p>
        {done.email && <a className="sx-big sx-ink" href={`mailto:${done.email.to}?subject=${encodeURIComponent(done.email.subject)}&body=${encodeURIComponent(done.email.body)}`} data-testid="sx-mail"><span className="sx-ic" aria-hidden="true">✉️</span><span>{t('simple.j.openEmail')}</span></a>}
        <Big to="/me/jobs" icon="📋" label={t('simple.tile.apps')} />
        <Big to="/me/simple/jobs" icon="←" label={t('simple.back')} />
      </section>
    );
  }
  const unanswered = (j.questions || []).some((q) => answers[q.id] == null || answers[q.id] === '');
  return (
    <section className="sx-stack" aria-labelledby="sx-apply-h" data-testid="sx-apply">
      <h1 id="sx-apply-h" className="sx-h1">{t('simple.j.applyTitle', { title: j.title })}</h1>
      <p className="sx-p"><strong>{j.company}</strong></p>
      {j.method === 'nm7' ? (
        <>
          {(j.questions || []).map((q) => <Question key={q.id} t={t} lang={lang} q={q} value={answers[q.id]} onChange={(v) => setAnswers({ ...answers, [q.id]: q.kind === 'number' && v !== '' ? Number(v) : v })} />)}
          <label className="sx-check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="sx-consent" /><span>{t('simple.j.consent', { company: j.company })}</span></label>
        </>
      ) : <p className="sx-p">{t(j.method === 'link' ? 'simple.j.onTheirSite' : 'simple.j.byEmail')}</p>}
      <button type="button" className="sx-big sx-ink" disabled={busy || (j.method === 'nm7' && (!consent || unanswered)) || j.demo} onClick={send} data-testid="sx-send"><span className="sx-ic" aria-hidden="true">➜</span><span>{t(j.method === 'link' ? 'simple.j.openSite' : 'simple.j.send')}</span></button>
      {j.demo && <p className="sx-hint">{t('simple.j.demo')}</p>}
      {note && <p className="sx-note" role="alert">{note}</p>}
      <Big to="/me/simple/jobs" icon="←" label={t('simple.back')} />
    </section>
  );
}

export function AutoOn({ t, lang, setSay }) {
  const nav = useNavigate();
  const { d, err } = useJobs();
  const [roles, setRoles] = useState([]);
  const [role, setRole] = useState('');
  const [city, setCity] = useState('');
  const [limit, setLimit] = useState(3);
  const [consent, setConsent] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { http('/api/me/auto-apply/suggest').then((r) => setRoles((r.roles || []).slice(0, 6)), () => {}); }, []);
  useEffect(() => { setSay([['simple.a.title'], ['simple.a.text']]); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <p className="sx-p" role={err ? 'alert' : 'status'}>{err || t('simple.loading')}</p>;
  const g = d.gate;
  const on = async () => {
    setBusy(true); setNote('');
    try {
      await http('/api/me/auto-apply', { method: 'PUT', body: { roles: [role], cities: city ? [city] : [], remote: true, dailyLimit: limit, consent } });
      nav('/me/simple/jobs');
    } catch (e) { setNote(e.message); } finally { setBusy(false); }
  };
  return (
    <section className="sx-stack" aria-labelledby="sx-auto-h" data-testid="sx-auto">
      <h1 id="sx-auto-h" className="sx-h1">{t('simple.a.title')}</h1>
      <p className="sx-p">{t('simple.a.text')}</p>
      {!g.ok ? (
        <div className="sx-stack" data-testid="sx-gate">
          <p className="sx-note" role="status">{g.score == null ? t('simple.a.noResume') : t('simple.next.fix_score.text', { score: g.score, need: g.need })}</p>
          <Big to={g.score == null ? '/me/simple/resume' : '/me/ats'} icon="📈" label={t('simple.next.fix_score.cta')} ink testid="sx-gate-fix" />
        </div>
      ) : (
        <>
          {roles.length > 0 && <div className="sx-chips">{roles.map((r) => <button key={r} type="button" className="sx-chipbtn" aria-pressed={role === r} onClick={() => setRole(r)} data-testid="sx-role-chip">{r}</button>)}</div>}
          <SpeakField id="sx-auto-role" label={t('simple.a.role')} value={role} onChange={setRole} t={t} lang={lang} testid="sx-auto-role" />
          <SpeakField id="sx-auto-city" label={t('simple.a.city')} value={city} onChange={setCity} t={t} lang={lang} testid="sx-auto-city" />
          <div className="sx-stack" role="group" aria-label={t('simple.a.limit')}>
            <span className="sx-flabel">{t('simple.a.limit')}</span>
            <div className="sx-chips">{[1, 3, 5, 10].filter((n) => n <= d.defaults.max).map((n) => <button key={n} type="button" className="sx-chipbtn" aria-pressed={limit === n} onClick={() => setLimit(n)} data-testid={`sx-limit-${n}`}>{n}</button>)}</div>
          </div>
          <label className="sx-check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="sx-auto-consent" /><span>{t('simple.a.consent')}</span></label>
          <button type="button" className="sx-big sx-ink" disabled={busy || !role.trim() || !consent} onClick={on} data-testid="sx-auto-on"><span className="sx-ic" aria-hidden="true">🤖</span><span>{t('simple.next.auto_apply.cta')}</span></button>
        </>
      )}
      {note && <p className="sx-note" role="alert">{note}</p>}
      <Link to="/me/auto-apply" className="sx-hint">{t('simple.a.all')}</Link>
      <Big to="/me/simple/jobs" icon="←" label={t('simple.back')} />
    </section>
  );
}

function useItems() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = () => http('/api/me/auto-apply/items').then(setD, (e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  return { d, err, load };
}

export function Answers({ t, lang, setSay }) {
  const { d, err, load } = useItems();
  const [a, setA] = useState({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const it = d?.needsAnswer?.[0];
  const words = it ? [[it.kind === 'borderline' ? 'simple.q.borderline' : 'simple.q.title', { title: it.job.title, company: it.job.company, score: it.score ?? '' }], ...(it.questions || []).map((q) => q.text)] : [['simple.q.none']];
  useEffect(() => { setSay(words); setA({}); }, [it?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <p className="sx-p" role={err ? 'alert' : 'status'}>{err || t('simple.loading')}</p>;
  const act = async (path, body) => {
    setBusy(true); setNote('');
    try { await http(`/api/me/auto-apply/items/${it.id}/${path}`, { method: 'POST', body }); await load(); } catch (e) { setNote(e.message); } finally { setBusy(false); }
  };
  const left = d.needsAnswer.length;
  return (
    <section className="sx-stack" aria-labelledby="sx-ans-h" data-testid="sx-answers">
      <h1 id="sx-ans-h" className="sx-h1">{t('simple.q.head')}</h1>
      {!it ? <p className="sx-p" data-testid="sx-answers-none">{t('simple.q.none')}</p> : (
        <div className="sx-next" data-testid="sx-answer-item">
          <span className="sx-cardtop"><span className="sx-label">{t('simple.q.left', { n: left })}</span><SayButton items={words} t={t} lang={lang} label={t('simple.voice.readCard')} testid="sx-answer-say" /></span>
          <h2 className="sx-h2">{t(it.kind === 'borderline' ? 'simple.q.borderline' : 'simple.q.title', { title: it.job.title, company: it.job.company, score: it.score ?? '' })}</h2>
          {it.kind === 'borderline' ? (
            <div className="sx-frow">
              <button type="button" className="sx-big sx-ink" disabled={busy} onClick={() => act('go', {})} data-testid="sx-borderline-go"><span>{t('simple.q.go')}</span></button>
              <button type="button" className="sx-big" disabled={busy} onClick={() => act('skip', {})} data-testid="sx-borderline-skip"><span>{t('simple.q.skip')}</span></button>
            </div>
          ) : (
            <>
              {(it.questions || []).map((q) => <Question key={q.id} t={t} lang={lang} q={q} value={a[q.id]} onChange={(v) => setA({ ...a, [q.id]: q.kind === 'number' && v !== '' ? Number(v) : v })} />)}
              <button type="button" className="sx-big sx-ink" disabled={busy || (it.questions || []).some((q) => a[q.id] == null || a[q.id] === '')} onClick={() => act('answer', { answers: a, remember: true })} data-testid="sx-answer-send"><span className="sx-ic" aria-hidden="true">✔</span><span>{t('simple.q.send')}</span></button>
              <p className="sx-hint">{t('simple.q.remember')}</p>
              <button type="button" className="sx-big" disabled={busy} onClick={() => act('skip', {})} data-testid="sx-answer-skip"><span>{t('simple.q.skip')}</span></button>
            </>
          )}
        </div>
      )}
      {note && <p className="sx-note" role="alert">{note}</p>}
      <Big to="/me/simple/jobs" icon="←" label={t('simple.back')} />
    </section>
  );
}

export function Outside({ t, lang, setSay }) {
  const { d, err, load } = useItems();
  const [note, setNote] = useState('');
  useEffect(() => { setSay([['simple.o.title'], ['simple.o.text']]); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <p className="sx-p" role={err ? 'alert' : 'status'}>{err || t('simple.loading')}</p>;
  const open = async (it) => {
    setNote('');
    const win = window.open('', '_blank');
    try {
      const r = await http(`/api/me/auto-apply/items/${it.id}/opened`, { method: 'POST' });
      if (win) { win.opener = null; win.location.href = r.url || it.applyUrl; } else window.open(r.url || it.applyUrl, '_blank', 'noopener');
      load();
    } catch (e) { win?.close(); setNote(e.message); }
  };
  return (
    <section className="sx-stack" aria-labelledby="sx-out-h" data-testid="sx-outside">
      <h1 id="sx-out-h" className="sx-h1">{t('simple.o.title')}</h1>
      <p className="sx-p">{t('simple.o.text')}</p>
      {d.ready.length === 0 && <p className="sx-p">{t('simple.o.none')}</p>}
      {d.ready.map((it) => (
        <article key={it.id} className="sx-next" data-testid="sx-outside-item">
          <span className="sx-cardtop"><h2 className="sx-h2">{it.job.title}</h2><SayButton items={[it.job.title, it.job.company, ['simple.o.text']]} t={t} lang={lang} label={t('simple.voice.readCard')} /></span>
          <p className="sx-p"><strong>{it.job.company}</strong></p>
          <button type="button" className="sx-big sx-ink" onClick={() => open(it)} data-testid="sx-outside-open"><span className="sx-ic" aria-hidden="true">🌐</span><span>{t('simple.o.open')}</span></button>
        </article>
      ))}
      {note && <p className="sx-note" role="alert">{note}</p>}
      <Big to="/me/simple/jobs" icon="←" label={t('simple.back')} />
    </section>
  );
}
