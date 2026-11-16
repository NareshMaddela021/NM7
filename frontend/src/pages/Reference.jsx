// /reference#t=… (Vetting V4): the page a referee opens from their email, no account needed. Who asked (the
// candidate's first name and how they know them), then 5 short questions: their role, when they worked together,
// "Would you hire or work with them again?" as three big buttons (Yes / Maybe / No), what they are best at and
// anything else (optional). Send → thank you. Already answered → thank you. A bad or old link → "This link doesn't
// work". The token is in the address fragment, so it never reaches server logs.
// GET/POST /api/public/reference/{token}.
import { useEffect, useState } from 'react';
import Header from '../components/Header';
import { http } from '../services/http';
import '../styles/me-kit.css';
import '../styles/vetting-l4.css';

const tokenOf = (hash) => (/(?:^#|&)t=([A-Za-z0-9._-]{10,200})/.exec(hash || '') || [])[1] || '';
const REHIRE = [['yes', 'Yes', 'Gladly'], ['maybe', 'Maybe', 'In the right role'], ['no', 'No', 'I wouldn’t']];
const LIMITS = { role: 120, dates: 60, strengths: 300, notes: 500 };
const HINTS = { role: 'For example: Support executive, my team', dates: 'For example: 2022 – 2024' };

export default function Reference() {
  const [token] = useState(() => tokenOf(typeof window !== 'undefined' ? window.location.hash : ''));
  const [d, setD] = useState(null);
  const [state, setState] = useState(token ? 'loading' : 'bad'); // loading | form | bad | done
  const [f, setF] = useState({ role: '', dates: '', rehire: '', strengths: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!token) return;
    http(`/api/public/reference/${encodeURIComponent(token)}`).then((x) => { setD(x); setState(x.answered ? 'done' : 'form'); }, () => setState('bad'));
  }, [token]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const send = async (e) => {
    e.preventDefault(); setErr('');
    const missing = [['role', 'their role'], ['dates', 'when you worked together'], ['rehire', 'whether you would work with them again'], ['strengths', 'what they are best at']]
      .filter(([k]) => (k === 'rehire' ? !f.rehire : f[k].trim().length < 2)).map(([, l]) => l);
    if (missing.length) { setErr(`Please answer: ${missing.join(', ')}.`); return; }
    setBusy(true);
    try {
      await http(`/api/public/reference/${encodeURIComponent(token)}`, { method: 'POST', body: { role: f.role.trim(), dates: f.dates.trim(), rehire: f.rehire, strengths: f.strengths.trim(), notes: f.notes.trim() } });
      setState('done');
    } catch (x) {
      if (x.status === 409) setState('done'); else setErr(x.message);
    } finally { setBusy(false); }
  };
  const q = Object.fromEntries((d?.questions || []).map((x) => [x.key, x.q]));
  const who = d?.candidate || 'The candidate';
  return (
    <>
      <Header />
      <main id="main" className="l4-ref-page stack g16">
        {state === 'loading' && <p className="muted" role="status">Loading…</p>}
        {state === 'bad' && (
          <section className="mcard stack g8" data-testid="ref-bad">
            <h1 className="display h2" style={{ margin: 0 }}>This link doesn't work</h1>
            <p className="muted" style={{ margin: 0 }}>It may be incomplete or old. Please open the link from the email again, or ask the person who named you to send it once more.</p>
          </section>
        )}
        {state === 'done' && (
          <section className="mcard stack g8" role="status" data-testid="ref-done">
            <h1 className="display h2" style={{ margin: 0 }}>Thank you</h1>
            <p className="muted" style={{ margin: 0 }}>Your answers are in. Companies only see a short line such as “Confirmed by a {d?.relation || 'past manager'}”, never your contact details. You can close this page.</p>
          </section>
        )}
        {state === 'form' && (
          <>
            <div className="stack g4">
              <span className="mkicker">Nm7 reference · about 2 minutes</span>
              <h1 className="display h2" style={{ margin: 0 }} data-testid="ref-who">{who} named you as their {d.relation}</h1>
              <p className="muted" style={{ margin: 0 }}>Five short questions to confirm they are who they say they are. Please answer honestly; your contact details are never shown to companies.</p>
            </div>
            <form className="mcard l4-big" onSubmit={send} noValidate data-testid="ref-form">
              {['role', 'dates'].map((k) => (
                <label key={k} className="field"><span className="label">{q[k]}</span>
                  <input className="input" maxLength={LIMITS[k]} value={f[k]} onChange={set(k)} placeholder={HINTS[k]} data-testid={`ref-${k}`} /></label>
              ))}
              <fieldset className="l4-crit">
                <legend className="label">{q.rehire}</legend>
                <div className="l4-rehire" role="radiogroup" aria-label={q.rehire}>
                  {REHIRE.map(([v, l, s]) => (
                    <button key={v} type="button" role="radio" className="l4-choice" aria-checked={f.rehire === v} onClick={() => setF((x) => ({ ...x, rehire: v }))} data-testid={`ref-rehire-${v}`}>
                      {l}<small>{s}</small>
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="field"><span className="label">{q.strengths}</span>
                <textarea className="input" rows={3} maxLength={LIMITS.strengths} value={f.strengths} onChange={set('strengths')} data-testid="ref-strengths" /></label>
              <label className="field"><span className="label">{q.notes}</span>
                <textarea className="input" rows={3} maxLength={LIMITS.notes} value={f.notes} onChange={set('notes')} data-testid="ref-notes" /></label>
              {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
              <button type="submit" className="btn btn-signal" style={{ alignSelf: 'flex-start', minHeight: 48 }} disabled={busy} data-testid="ref-send">{busy ? 'Sending…' : 'Send my answers'}</button>
            </form>
          </>
        )}
      </main>
    </>
  );
}
