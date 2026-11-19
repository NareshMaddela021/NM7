// Vetting Trust T15: the reliability record's one-tap pages (no sign-in; /stop-alerts#k=ratt|rstay|rme&t=…, the token
// stays in the address fragment) and the list the candidate uses on My hiring too (RelItems):
//   ratt   the company, after an interview time: Attended / No-show
//   rstay  the company, 30 / 90 days after joining: still working here? Yes / No (with a reason)
//   rme    the candidate (English, Hindi or Telugu): what happened? (an emergency / the company cancelled …) within 48
//          hours, dispute a record (a person at Nm7 checks), "I'm still working there"
// Loaded only with TrustLink (and by the My hiring card).
import { useEffect, useState } from 'react';
import { http } from '../../../services/http';

const BTN = { minHeight: 44 };
const IST = { timeZone: 'Asia/Kolkata' };
const when = (ms) => new Date(ms).toLocaleString('en-IN', { ...IST, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const day = (iso) => new Date(`${iso}T12:00:00+05:30`).toLocaleDateString('en-IN', { ...IST, day: 'numeric', month: 'long', year: 'numeric' });

export const RL = {
  en: { record: 'Your reliability record', none: 'No history yet', explain: 'Tell us what happened', dispute: 'Dispute this', by: 'Answer by', send: 'Send', back: 'Back',
    still: 'I’m still working at', what: { interview: 'Interview', join: 'Joining', stay30: '30 days in the job', stay90: '90 days in the job' },
    said: { yes: 'Yes', no: 'The company said no' }, state: { counted: 'Counts', waiting: 'Waiting for your answer', excused: 'Not counted (you explained)', disputed: 'A person at Nm7 is checking', removed: 'Removed after a check' },
    why: { emergency: 'I had an emergency', job_ended: 'The company let me go / the job ended', company_cancelled: 'The company cancelled or moved it', was_there: 'I was there / I did join', still_working: 'I’m still working there', other: 'Something else' },
    whyText: 'In a few words (only Nm7 sees this)', thanks: 'Thank you. Saved.' },
  hi: { record: 'आपका भरोसे का रिकॉर्ड', none: 'अभी कोई इतिहास नहीं', explain: 'बताएँ क्या हुआ', dispute: 'इस पर आपत्ति करें', by: 'जवाब दें', send: 'भेजें', back: 'वापस',
    still: 'मैं अभी भी यहाँ काम कर रहा/रही हूँ:', what: { interview: 'इंटरव्यू', join: 'जॉइनिंग', stay30: 'नौकरी में 30 दिन', stay90: 'नौकरी में 90 दिन' },
    said: { yes: 'हाँ', no: 'कंपनी ने ना कहा' }, state: { counted: 'गिना गया', waiting: 'आपके जवाब का इंतज़ार', excused: 'नहीं गिना (आपने बताया)', disputed: 'Nm7 का एक व्यक्ति जाँच रहा है', removed: 'जाँच के बाद हटाया गया' },
    why: { emergency: 'मुझे कोई इमरजेंसी थी', job_ended: 'कंपनी ने निकाला / नौकरी खत्म हुई', company_cancelled: 'कंपनी ने रद्द किया या बदला', was_there: 'मैं वहाँ था/थी / मैंने जॉइन किया', still_working: 'मैं अभी भी वहाँ काम करता/करती हूँ', other: 'कुछ और' },
    whyText: 'कुछ शब्दों में (सिर्फ़ Nm7 देखेगा)', thanks: 'धन्यवाद, सेव हो गया।' },
  te: { record: 'మీ నమ్మకత్వ రికార్డు', none: 'ఇంకా చరిత్ర లేదు', explain: 'ఏం జరిగిందో చెప్పండి', dispute: 'దీనిపై అభ్యంతరం చెప్పండి', by: 'ఇంతలోగా జవాబివ్వండి', send: 'పంపండి', back: 'వెనక్కి',
    still: 'నేను ఇంకా ఇక్కడ పని చేస్తున్నాను:', what: { interview: 'ఇంటర్వ్యూ', join: 'ఉద్యోగంలో చేరడం', stay30: 'ఉద్యోగంలో 30 రోజులు', stay90: 'ఉద్యోగంలో 90 రోజులు' },
    said: { yes: 'అవును', no: 'కంపెనీ కాదని చెప్పింది' }, state: { counted: 'లెక్కలోకి వచ్చింది', waiting: 'మీ జవాబు కోసం చూస్తున్నాం', excused: 'లెక్కలోకి రాదు (మీరు చెప్పారు)', disputed: 'Nm7లో ఒకరు చూస్తున్నారు', removed: 'తనిఖీ తర్వాత తీసేశాం' },
    why: { emergency: 'నాకు అత్యవసర పరిస్థితి వచ్చింది', job_ended: 'కంపెనీ తీసేసింది / ఉద్యోగం ముగిసింది', company_cancelled: 'కంపెనీ రద్దు చేసింది లేదా మార్చింది', was_there: 'నేను వెళ్ళాను / చేరాను', still_working: 'నేను ఇంకా అక్కడ పని చేస్తున్నాను', other: 'ఇంకేదైనా' },
    whyText: 'కొన్ని మాటల్లో (Nm7 మాత్రమే చూస్తుంది)', thanks: 'ధన్యవాదాలు, సేవ్ అయింది.' },
};
const EXCUSE = { interview: ['emergency', 'company_cancelled', 'other'], join: ['emergency', 'company_cancelled', 'other'], stay30: ['job_ended', 'still_working', 'other'], stay90: ['job_ended', 'still_working', 'other'] };
const DISPUTE = { interview: ['company_cancelled', 'was_there', 'other'], join: ['was_there', 'company_cancelled', 'other'], stay30: ['still_working', 'other'], stay90: ['still_working', 'other'] };

function Answer({ it, t, mode, onSend, onBack, busy }) {
  const [why, setWhy] = useState('');
  const [text, setText] = useState('');
  const list = (mode === 'explain' ? EXCUSE : DISPUTE)[it.kind];
  return (
    <div className="stack g8" data-testid="rel-answer">
      <div className="stack g4" role="radiogroup" aria-label={mode === 'explain' ? t.explain : t.dispute}>
        {list.map((k) => <label key={k} className="row g8" style={{ minHeight: 44, alignItems: 'center' }}><input type="radio" name={`rel-${it.id}`} checked={why === k} onChange={() => setWhy(k)} data-testid={`rel-why-${k}`} /><span>{t.why[k]}</span></label>)}
      </div>
      {why === 'other' && <input className="input" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} aria-label={t.whyText} placeholder={t.whyText} data-testid="rel-why-text" />}
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-signal" style={BTN} disabled={busy || !why || (why === 'other' && text.trim().length < 5)} onClick={() => onSend(why, text)} data-testid="rel-send">{t.send}</button>
        <button type="button" className="btn btn-ghost" style={BTN} onClick={onBack}>{t.back}</button>
      </div>
    </div>
  );
}

/** The record summary, each record with its state, and what the person can do (explain, dispute, confirm a stay). */
export function RelItems({ d, lang = 'en', onAnswer, onStay }) {
  const t = RL[lang] || RL.en;
  const [open, setOpen] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async (fn) => { setBusy(true); setMsg(''); try { await fn(); setOpen({}); setMsg(t.thanks); } catch (e) { setMsg(e.message); } finally { setBusy(false); } };
  return (
    <div className="stack g12">
      <p style={{ margin: 0 }} data-testid="rel-summary"><strong>{d.summary.empty ? t.none : d.summary.text}</strong>{!d.summary.empty && <span className="xs muted"> · {d.summary.source}</span>}</p>
      {d.stays?.map((s) => (
        <button key={`${s.offer}-${s.days}`} type="button" className="btn btn-outline" style={{ ...BTN, alignSelf: 'flex-start', whiteSpace: 'normal' }} disabled={busy}
          onClick={() => run(() => onStay(s.offer, s.days))} data-testid="rel-stay">✓ {t.still} {s.company} ({s.days})</button>
      ))}
      {d.items?.length > 0 && (
        <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }} data-testid="rel-items">
          {d.items.map((it) => (
            <li key={it.id} className="mcard mcard-tight stack g8" data-testid="rel-item">
              <span className="row g8" style={{ flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <strong className="small">{t.what[it.kind]} · {it.company}{it.role ? ` · ${it.role}` : ''}</strong>
                <span className={`mchip ${it.state === 'waiting' ? 'mchip-warn' : it.outcome === 'yes' && it.state === 'counted' ? 'mchip-ok' : 'mchip-neutral'}`} data-testid="rel-state">{it.outcome === 'yes' ? t.said.yes : t.state[it.state]}</span>
              </span>
              {it.outcome === 'no' && it.state === 'waiting' && <span className="xs" data-testid="rel-window">{t.said.no}. {t.by}: {when(it.respondBy)}</span>}
              {open[it.id] ? <Answer it={it} t={t} mode={open[it.id]} busy={busy} onBack={() => setOpen({})} onSend={(why, text) => run(() => onAnswer(it.id, why, text))} />
                : (
                  <span className="row g8" style={{ flexWrap: 'wrap' }}>
                    {it.canExplain && <button type="button" className="btn btn-signal" style={BTN} onClick={() => setOpen({ [it.id]: 'explain' })} data-testid="rel-explain">{t.explain}</button>}
                    {it.canDispute && !it.canExplain && <button type="button" className="btn btn-outline" style={BTN} onClick={() => setOpen({ [it.id]: 'dispute' })} data-testid="rel-dispute">{t.dispute}</button>}
                  </span>
                )}
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="small" role="status" data-testid="rel-msg" style={{ margin: 0 }}>{msg}</p>}
    </div>
  );
}

function useLink(api, token) {
  const [d, setD] = useState(null);
  const [st, setSt] = useState({});
  useEffect(() => { http(`${api}/check`, { method: 'POST', body: { token } }).then(setD, (e) => setSt({ error: e.message })); }, [api, token]);
  const act = async (body) => {
    setSt({ busy: true });
    try { setD(await http(`${api}/act`, { method: 'POST', body: { token, ...body } })); setSt({}); return true; } catch (e) { setSt({ error: e.message }); throw e; }
  };
  return { d, st, act };
}

export function RelMe({ token }) {
  const { d, st, act } = useLink('/api/public/trust/rel/me', token);
  if (!d) return st.error ? <p role="alert" className="error" data-testid="rme-error">{st.error}</p> : <p className="muted">Checking the link…</p>;
  const t = RL[d.lang] || RL.en;
  return (
    <div className="stack g12" data-testid="rme" lang={d.lang}>
      <p style={{ margin: 0 }}>{d.first ? `${d.first} · ` : ''}{t.record}</p>
      <RelItems d={d} lang={d.lang} onAnswer={(id, why, text) => act({ id, why, text })} onStay={(offer, days) => act({ offer, days })} />
    </div>
  );
}

export function RelAttendance({ token }) {
  const { d, st, act } = useLink('/api/public/trust/rel/att', token);
  if (!d) return st.error ? <p role="alert" className="error" data-testid="ratt-error">{st.error}</p> : <p className="muted">Checking the link…</p>;
  return (
    <div className="stack g16" data-testid="ratt">
      <p style={{ margin: 0 }}>Did <strong>{d.first}</strong> come to the interview{d.role ? ` for ${d.role}` : ''} on {when(d.at)}?</p>
      {d.mark && <p role="status" data-testid="ratt-done">Thanks: marked as {d.mark === 'attended' ? 'attended' : 'no-show'}. You can change it in Hire → Interview times.</p>}
      {!d.mark && d.canMark && (
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-signal" style={BTN} disabled={st.busy} onClick={() => act({ result: 'attended' }).catch(() => {})} data-testid="ratt-yes">Attended</button>
          <button type="button" className="btn btn-outline" style={BTN} disabled={st.busy} onClick={() => act({ result: 'no_show' }).catch(() => {})} data-testid="ratt-no">No-show</button>
        </div>
      )}
      <span className="xs muted">This feeds the candidate’s reliability record on Nm7 (only totals are shown, never which company said what). A no-show counts only after they had 48 hours to tell us why.</span>
      {st.error && <p role="alert" className="error">{st.error}</p>}
    </div>
  );
}

export function RelStay({ token }) {
  const { d, st, act } = useLink('/api/public/trust/rel/stay', token);
  const [no, setNo] = useState(0);
  const [why, setWhy] = useState('');
  if (!d) return st.error ? <p role="alert" className="error" data-testid="rstay-error">{st.error}</p> : <p className="muted">Checking the link…</p>;
  return (
    <div className="stack g16" data-testid="rstay">
      <p style={{ margin: 0 }}><strong>{d.candidate || 'Your hire'}</strong> · {d.role} · joined {day(d.joinDate)}</p>
      {d.due.map((days) => (
        <div key={days} className="stack g8" data-testid={`rstay-${days}`}>
          <strong className="small">Still working with you after {days} days?</strong>
          {d.answers[String(days)] ? <p role="status" style={{ margin: 0 }} data-testid="rstay-done">Thanks: {d.answers[String(days)] === 'yes' ? 'still working' : 'no longer working'}.</p>
            : no === days ? (
              <div className="stack g8">
                <input className="input" maxLength={300} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="What happened? (kept with the record)" aria-label="What happened?" data-testid="rstay-why" />
                <button type="button" className="btn btn-signal" style={{ ...BTN, alignSelf: 'flex-start' }} disabled={st.busy || why.trim().length < 3} onClick={() => act({ days, working: false, reason: why }).then(() => setNo(0), () => {})} data-testid="rstay-send">Send</button>
              </div>
            ) : (
              <div className="row g8" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-signal" style={BTN} disabled={st.busy} onClick={() => act({ days, working: true }).catch(() => {})} data-testid="rstay-yes">Yes, still working</button>
                <button type="button" className="btn btn-outline" style={BTN} onClick={() => setNo(days)} data-testid="rstay-no">No</button>
              </div>
            )}
        </div>
      ))}
      <span className="xs muted">This feeds their reliability record on Nm7 (only totals are shown). If you say no, they can tell us their side first.</span>
      {st.error && <p role="alert" className="error">{st.error}</p>}
    </div>
  );
}
