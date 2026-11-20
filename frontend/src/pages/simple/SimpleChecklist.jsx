// Profile setup P4: the setup checklist on the Easy dashboard. The same steps from the same API as the full dashboard's
// card (GET /api/me/checklist, POST /api/me/checklist/{role}/skip; backend app/setup/checklist.py), with bigger
// buttons and simple words in English / Telugu / Hindi.
//   SetupCard (on /me/simple)   "Set up your profile": 3 of 7 steps done (a bar), the next step in simple words, one big
//                               "Do this step" button, "Skip for now" and "See all steps"
//   /me/simple/setup            every step with its status (Done / Do next / Later / Being checked) and a big button
// This file, lib/checklist.js and the strings (src/i18n/setup.json, all three languages) are one lazy chunk: nothing
// here is in the Easy dashboard's first download (its 150 KB budget). Icons: ui.jsx's Icon (already downloaded).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/ui';
import { getChecklist, markOpened, nextStep, showCard, skipStep } from '../../lib/checklist';
import { translate } from '../../lib/i18n';
import SETUP from '../../i18n/setup.json';
import { SayButton } from './voice';

// steps that have an easy screen of their own; the rest open the full page (the server's link)
export const EASY_LINKS = {
  'jobseeker.resume': '/me/simple/fixes',
  'jobseeker.autoapply': '/me/simple/auto',
  'student.resume': '/me/simple/resume',
  'student.apply': '/me/simple/jobs',
};

/** t for this file's strings (setup.json): the language's own, else English, else the key. */
export const tsFor = (lang) => (key, vars) => translate(lang, key, vars, SETUP);

/** A step in simple words: its own strings when there are some, else the server's title and reward. */
export function words(ts, role, s) {
  const k = `setup.s.${role}.${s.id}`;
  const has = SETUP.en[`${k}.title`] != null;
  return { title: has ? ts(`${k}.title`) : s.title, text: has ? ts(`${k}.text`) : s.reward };
}

export const easyLink = (role, s) => EASY_LINKS[`${role}.${s.id}`] || s.link;

function useChecklist() {
  const [c, setC] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => { let dead = false; getChecklist().then((x) => { if (!dead) setC(x); }, () => { if (!dead) setErr(true); }); return () => { dead = true; }; }, []);
  return [c, setC, err];
}

function Progress({ ts, c }) {
  const label = ts('setup.progress', { done: c.done, total: c.total });
  return (
    <div className="sx-stack sx-setup-prog">
      <span className="sx-p" data-testid="sx-setup-progress"><strong>{label}</strong></span>
      <div className="sx-bar" role="progressbar" aria-valuemin={0} aria-valuemax={c.total} aria-valuenow={c.done} aria-label={label}><span style={{ width: `${c.total ? (100 * c.done) / c.total : 100}%` }} /></div>
    </div>
  );
}

/** The card itself (pure: tested in SimpleChecklist.test.jsx). */
export function CardView({ c, t, lang, busy, note, onSkip }) {
  if (!showCard(c)) return null;
  const ts = tsFor(lang);
  if (c.complete) {
    return <p className="sx-note sx-ok sx-setup-done" data-testid="sx-setup-complete"><Icon name="check" size={22} /> {ts('setup.complete')}</p>;
  }
  const nx = nextStep(c);
  const w = nx && words(ts, c.role, nx);
  const waiting = c.steps.filter((s) => s.status === 'waiting');
  const say = [ts('setup.title'), ts('setup.progress', { done: c.done, total: c.total }), ...(w ? [w.title, w.text] : [])];
  return (
    <section className="sx-next" aria-labelledby="sx-setup-h" data-testid="sx-setup" data-role={c.role} data-next={nx?.id || ''}>
      <span className="sx-cardtop"><h2 id="sx-setup-h" className="sx-label">{ts('setup.title')}</h2><SayButton items={say} t={t} lang={lang} label={t('simple.voice.readCard')} testid="sx-setup-say" /></span>
      <Progress ts={ts} c={c} />
      {nx ? (
        <>
          <h3 className="sx-h2" data-testid="sx-setup-next-title">{w.title}</h3>
          <p className="sx-p">{w.text}</p>
          <span className="sx-hint">{ts('setup.minutes', { n: nx.minutes })}</span>
          <Link to={easyLink(c.role, nx)} className="sx-big sx-ink sx-setup-go" onClick={markOpened} data-testid="sx-setup-go"><span>{ts('setup.go')}</span><Icon name="arrow" size={24} /></Link>
          <button type="button" className="sx-big sx-setup-skip" disabled={busy} onClick={() => onSkip(nx.id)} data-testid="sx-setup-skip">{ts('setup.skip')}</button>
        </>
      ) : waiting.length > 0 && <p className="sx-p" data-testid="sx-setup-waiting">{ts('setup.waiting')}</p>}
      {note && <p className="sx-note" role="status" data-testid="sx-setup-note">{note}</p>}
      <Link to="/me/simple/setup" className="sx-big sx-setup-all" data-testid="sx-setup-all"><span>{ts('setup.all', { n: c.steps.length })}</span></Link>
    </section>
  );
}

function useSkip(c, setC, lang) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const ts = tsFor(lang);
  const skip = async (id) => {
    setBusy(true); setNote('');
    try { setC(await skipStep(c.role, id)); setNote(ts('setup.skipped')); } catch { setNote(ts('setup.error')); } finally { setBusy(false); }
  };
  return { busy, note, skip };
}

/** On /me/simple, under "Your next step". Nothing while it loads or when the checklist isn't for this account. */
export function SetupCard({ t, lang }) {
  const [c, setC] = useChecklist();
  const { busy, note, skip } = useSkip(c, setC, lang);
  return <CardView c={c} t={t} lang={lang} busy={busy} note={note} onSkip={skip} />;
}

/** /me/simple/setup: every step (pure: tested in SimpleChecklist.test.jsx). */
export function StepsView({ c, t, lang, busy, note, onSkip, err }) {
  const ts = tsFor(lang);
  const back = <Link to="/me/simple" className="sx-big" data-testid="sx-setup-back"><Icon name="back" size={24} /><span>{t('simple.back')}</span></Link>;
  if (!c || !showCard(c)) {
    return <section className="sx-stack" aria-labelledby="sx-steps-h"><h1 id="sx-steps-h" className="sx-h1">{ts('setup.page')}</h1><p className="sx-p" role={err ? 'alert' : 'status'}>{err || c ? ts('setup.none') : t('simple.loading')}</p>{back}</section>;
  }
  return (
    <section className="sx-stack" aria-labelledby="sx-steps-h" data-testid="sx-steps">
      <h1 id="sx-steps-h" className="sx-h1">{ts('setup.page')}</h1>
      {c.complete ? <p className="sx-note sx-ok" data-testid="sx-setup-complete">{ts('setup.complete')}</p> : <Progress ts={ts} c={c} />}
      {note && <p className="sx-note" role="status" data-testid="sx-setup-note">{note}</p>}
      <ol className="sx-list">
        {c.steps.map((s, i) => {
          const w = words(ts, c.role, s);
          return (
            <li key={s.id} className={`sx-next sx-step sx-step-${s.status}`} data-testid="sx-step" data-step={s.id} data-status={s.status}>
              <span className="sx-cardtop">
                <span className="sx-label">{i + 1}. {ts(`setup.status.${s.status}`)}{s.status === 'done' && <Icon name="check" size={20} />}</span>
                {!s.required && s.status !== 'done' && <span className="sx-hint">{ts('setup.optional')}</span>}
              </span>
              <strong className="sx-h2">{w.title}</strong>
              {s.status !== 'done' && <p className="sx-p">{w.text}</p>}
              {s.skipped && <span className="sx-hint">{ts('setup.wasSkipped')}</span>}
              {(s.status === 'next' || s.status === 'later') && (
                <Link to={easyLink(c.role, s)} className={`sx-big sx-step-go${s.status === 'next' ? ' sx-ink' : ''}`} onClick={markOpened} data-testid="sx-step-go"><span>{ts(s.status === 'next' ? 'setup.go' : 'setup.open')}</span><Icon name="arrow" size={24} /></Link>
              )}
              {(s.status === 'next' || s.status === 'later') && !s.skipped && <button type="button" className="sx-big sx-setup-skip" disabled={busy} onClick={() => onSkip(s.id)} data-testid="sx-step-skip">{ts('setup.skip')}</button>}
            </li>
          );
        })}
      </ol>
      {back}
    </section>
  );
}

/** One default export for both (SimpleApp's lazy import stays one line): `card` -> the card, else the steps page. */
export default function Setup(props) {
  return props.card ? <SetupCard {...props} /> : <SetupSteps {...props} />;
}

function SetupSteps({ t, lang, setSay }) {
  const [c, setC, err] = useChecklist();
  const { busy, note, skip } = useSkip(c, setC, lang);
  const ts = tsFor(lang);
  useEffect(() => { setSay([ts('setup.page'), ...(c && !c.complete ? [ts('setup.progress', { done: c.done, total: c.total })] : [])]); }, [c?.done, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  return <StepsView c={c} t={t} lang={lang} busy={busy} note={note} onSkip={skip} err={err} />;
}
