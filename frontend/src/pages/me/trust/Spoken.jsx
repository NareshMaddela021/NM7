// Vetting Trust T10: the spoken-English score (CEFR-style band A1–C2 with four sub-scores: pronunciation, fluency,
// grammar, comprehension) measured from the AI interview's spoken English answers. Only for people Vetting Trust is on
// for (the server sends `spoken` then):
//   SpokenChoice  in the interview set-up (voice + English): "Also measure my spoken English", with the voice consent
//                 text to agree to first and what is measured
//   SpokenScore   the band, what it means, the sub-scores, "how this was measured"
//   SpokenResult  on an interview result (being measured / the score)
//   SpokenCard    Profile & settings -> the score, and how to retake it (the interview's retake limits, T9)
// Loaded lazily by the interview page; SpokenCard sits in the Privacy & consent chunk (no new route).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../../../services/http';
import { Bar, Chip, MeCard } from '../kit';
import { bandTone } from './spokenLib';
import { IcMessage } from '../../../components/icons';

const day = (t) => (t ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function SpokenChoice({ d, mode, lang, on, onChange }) {
  const [consent, setConsent] = useState(!!d?.consent);
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState('');
  if (!d) return null;
  if (mode !== 'voice' || lang !== 'en') {
    return <p className="xs muted" style={{ margin: 0 }} data-testid="sp-choice-off">Spoken-English score: choose “Speak my answers” in English to have your spoken English measured too (optional).</p>;
  }
  const tick = (v) => { setErr(''); if (v && !consent) { setAsking(true); return; } onChange(v); };
  const agree = async () => {
    setErr('');
    try { await http('/api/me/trust/consents/voice', { method: 'POST' }); setConsent(true); setAsking(false); onChange(true); } catch (e) { setErr(e.message); }
  };
  return (
    <div className="stack g8" data-testid="sp-choice">
      <label className="vet-check">
        <input type="checkbox" checked={on} onChange={(e) => tick(e.target.checked)} aria-label="Also measure my spoken English (optional)" data-testid="sp-tick" />
        <span><strong>Also measure my spoken English (optional)</strong>
          <span className="xs muted" style={{ display: 'block' }}>You get a band from A1 to C2 with scores for pronunciation, fluency, grammar and comprehension, on your profile. It never changes your interview score, and nobody is rejected because of it.</span>
        </span>
      </label>
      {!d.pronunciation && <p className="xs muted" style={{ margin: 0 }} data-testid="sp-no-pron">Pronunciation can’t be measured right now, so your band will use fluency, grammar and comprehension.</p>}
      {asking && (
        <div className="mcard mcard-flat stack g8" role="group" aria-label={d.consentTitle} data-testid="sp-consent">
          <strong className="small">{d.consentTitle}</strong>
          <p className="small" style={{ margin: 0 }}>{d.consentText}</p>
          {d.pronunciation && <p className="xs muted" style={{ margin: 0 }}>For this score, a short recording of each spoken answer goes to our speech-assessment partner and is then deleted. We keep only the scores.</p>}
          {err && <p className="error" role="alert">{err}</p>}
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} onClick={agree} data-testid="sp-agree">I agree</button>
            <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={() => setAsking(false)}>Not now</button>
          </div>
        </div>
      )}
    </div>
  );
}

function How({ how }) {
  if (!how?.length) return null;
  return (
    <details className="small" data-testid="sp-how">
      <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>How this was measured</summary>
      <ul className="stack g4" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{how.map((h) => <li key={h}>{h}</li>)}</ul>
    </details>
  );
}

export function SpokenScore({ s, how }) {
  if (!s) return null;
  if (!s.band) return <p className="small" style={{ margin: 0 }} data-testid="sp-none">{s.reason}</p>;
  return (
    <div className="stack g12" data-testid="sp-score">
      <div className="row g8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip tone={bandTone(s.band)} testid="sp-band">Spoken English: {s.band}</Chip>
        <span className="xs muted">{s.source} · {day(s.at)}</span>
      </div>
      <p className="small" style={{ margin: 0 }} data-testid="sp-band-text">{s.bandText}</p>
      <div className="stack g8">
        {s.subs.map((x) => (x.measured
          ? <div key={x.key} data-testid={`sp-sub-${x.key}`}><Bar value={x.score} max={100} label={`${x.label}: ${x.score} / 100`} showValue={false} tone="accent" />{x.detail && <span className="xs muted">{x.detail}</span>}</div>
          : <p key={x.key} className="small" style={{ margin: 0 }} data-testid={`sp-sub-${x.key}`}>{x.label}: <strong>not measured</strong></p>))}
      </div>
      {s.note && <p className="xs muted" style={{ margin: 0 }} data-testid="sp-note">{s.note}</p>}
      <How how={how} />
    </div>
  );
}

export function SpokenResult({ s }) {
  if (!s) return null;
  return (
    <MeCard tone="flat" icon={<IcMessage />} title="Your spoken English" sub="From your spoken English answers. It never changes your interview score." testid="iv-spoken" headingLevel={3}>
      {s.pending ? <p className="small" style={{ margin: 0 }}>Being measured. Open this result again in a minute.</p> : <SpokenScore s={s} />}
      <Link className="small" to="/me/settings#spoken">See it on your profile, with how it was measured</Link>
    </MeCard>
  );
}

export default function SpokenCard() {
  const [d, setD] = useState(null);
  useEffect(() => { http('/api/me/trust/spoken').then(setD, () => setD(false)); }, []);
  if (!d) return null;
  const rk = d.retake;
  return (
    <MeCard icon={<IcMessage />} title="Spoken English" sub="A band from A1 to C2, measured by the AI interview when you speak in English." testid="sp-card" id="spoken">
      {d.score ? <SpokenScore s={d.score} how={d.how} /> : (
        <>
          <p className="small" style={{ margin: 0 }} data-testid="sp-empty">No spoken-English score yet. In the AI interview choose “Speak my answers” in English and tick “Also measure my spoken English”.</p>
          <How how={d.how} />
        </>
      )}
      <p className="small" style={{ margin: 0 }} data-testid="sp-retake">
        {rk ? <>Retake: take the AI interview again ({rk.rule} for this role). {rk.canStart ? 'You can start now.' : `Next attempt opens on ${day(rk.nextAt)}.`} The latest measured interview counts.</>
          : 'Your latest measured interview counts; you can retake the interview when its retake limit allows.'}{' '}
        <Link to="/me/interviews">AI interview</Link>
      </p>
      {!d.consent && d.score === null && <p className="xs muted" style={{ margin: 0 }}>It needs the “{d.consentTitle}” consent, asked when you choose it.</p>}
    </MeCard>
  );
}
