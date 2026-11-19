// Vetting Trust T11: the one-tap pages behind the signed links in WhatsApp messages and emails (no sign-in), opened at
// /stop-alerts#k=book|join|cjoin&t=… (the token stays in the address fragment, so it never reaches server logs):
//   book   the company's free interview times: one tap books; the same link moves or cancels until 2 hours before,
//          then "I can't make it" tells the company
//   join   the joining day: "Yes, I'm coming" / "Need to reschedule" before it, "I've joined" on the day (+ the T3 selfie)
//   cjoin  the company: did they join? Joined / Didn't join (with a reason)
// The candidate pages speak English, Hindi or Telugu (the language chosen for WhatsApp). Loaded only with TrustLink.
import { useEffect, useState } from 'react';
import { http } from '../../../services/http';

const L = {
  en: {
    checking: 'Checking the link…', pick: 'Pick a time', none: 'No free times right now. The company can add more; we’ll message you.',
    booked: 'Your interview', change: 'Pick another time to move it.', until: 'You can move or cancel it until', locked: 'It is less than {h} hours away, so it can’t be moved here.',
    cancel: 'Cancel the interview', why: 'Why? (the company sees this)', send: 'Send', back: 'Back', cant: 'I can’t make it', cantDone: 'We told the company you can’t make it. They will contact you.',
    map: 'Map', online: 'Join online', closed: 'The company is no longer inviting interviews for this job.', book: 'Book', expires: 'This link works until',
    joinTitle: 'Your joining day', at: 'at', yes: 'Yes, I’m coming', resched: 'Need to reschedule', joined: 'I’ve joined', joinedDone: 'Congratulations on joining! We told the company.',
    coming: 'Thanks: see you there. We told the company.', reschedDone: 'We told the company. They will reply to you.', selfie: 'Do your joining-day selfie check',
    reschedWhy: 'What do you need? (for example: “Can I join on Monday?”)', directions: 'Directions', interview: 'Interview',
  },
  hi: {
    checking: 'लिंक जाँच रहे हैं…', pick: 'समय चुनें', none: 'अभी कोई खाली समय नहीं है। कंपनी और समय जोड़ सकती है; हम आपको बताएँगे।',
    booked: 'आपका इंटरव्यू', change: 'बदलने के लिए दूसरा समय चुनें।', until: 'आप इसे इस समय तक बदल या रद्द कर सकते हैं:', locked: '{h} घंटे से कम बचे हैं, इसलिए यहाँ नहीं बदल सकते।',
    cancel: 'इंटरव्यू रद्द करें', why: 'क्यों? (कंपनी यह देखेगी)', send: 'भेजें', back: 'वापस', cant: 'मैं नहीं आ पाऊँगा/पाऊँगी', cantDone: 'हमने कंपनी को बता दिया। वे आपसे संपर्क करेंगे।',
    map: 'नक्शा', online: 'ऑनलाइन जुड़ें', closed: 'कंपनी अब इस नौकरी के इंटरव्यू नहीं ले रही।', book: 'बुक करें', expires: 'यह लिंक इस तारीख तक चलेगा:',
    joinTitle: 'आपका जॉइनिंग का दिन', at: '', yes: 'हाँ, मैं आ रहा/रही हूँ', resched: 'तारीख बदलनी है', joined: 'मैंने जॉइन किया', joinedDone: 'जॉइन करने की बधाई! हमने कंपनी को बता दिया।',
    coming: 'धन्यवाद, वहीं मिलते हैं। हमने कंपनी को बता दिया।', reschedDone: 'हमने कंपनी को बता दिया। वे आपको जवाब देंगे।', selfie: 'जॉइनिंग के दिन की सेल्फ़ी जाँच करें',
    reschedWhy: 'आपको क्या चाहिए? (जैसे: “क्या मैं सोमवार को जॉइन कर सकता हूँ?”)', directions: 'रास्ता', interview: 'इंटरव्यू',
  },
  te: {
    checking: 'లింక్ చూస్తున్నాం…', pick: 'సమయం ఎంచుకోండి', none: 'ఇప్పుడు ఖాళీ సమయాలు లేవు. కంపెనీ మరిన్ని జోడించవచ్చు; మేము మీకు చెబుతాం.',
    booked: 'మీ ఇంటర్వ్యూ', change: 'మార్చడానికి వేరే సమయం ఎంచుకోండి.', until: 'దీన్ని ఈ సమయం వరకు మార్చవచ్చు లేదా రద్దు చేయవచ్చు:', locked: '{h} గంటల కంటే తక్కువ ఉంది, కాబట్టి ఇక్కడ మార్చలేరు.',
    cancel: 'ఇంటర్వ్యూ రద్దు చేయండి', why: 'ఎందుకు? (కంపెనీ చూస్తుంది)', send: 'పంపండి', back: 'వెనక్కి', cant: 'నేను రాలేను', cantDone: 'మీరు రాలేరని కంపెనీకి చెప్పాం. వారు మిమ్మల్ని సంప్రదిస్తారు.',
    map: 'మ్యాప్', online: 'ఆన్‌లైన్‌లో చేరండి', closed: 'ఈ ఉద్యోగానికి కంపెనీ ఇక ఇంటర్వ్యూలు చేయడం లేదు.', book: 'బుక్ చేయండి', expires: 'ఈ లింక్ ఈ తేదీ వరకు పనిచేస్తుంది:',
    joinTitle: 'మీరు చేరే రోజు', at: '', yes: 'అవును, వస్తున్నాను', resched: 'తేదీ మార్చాలి', joined: 'చేరాను', joinedDone: 'చేరినందుకు అభినందనలు! కంపెనీకి చెప్పాం.',
    coming: 'ధన్యవాదాలు, అక్కడ కలుద్దాం. కంపెనీకి చెప్పాం.', reschedDone: 'కంపెనీకి చెప్పాం. వారు మీకు జవాబిస్తారు.', selfie: 'చేరే రోజు సెల్ఫీ చెక్ చేయండి',
    reschedWhy: 'మీకు ఏం కావాలి? (ఉదా: “సోమవారం చేరవచ్చా?”)', directions: 'దారి', interview: 'ఇంటర్వ్యూ',
  },
};
const IST = { timeZone: 'Asia/Kolkata' };
const when = (ms) => new Date(ms).toLocaleString('en-IN', { ...IST, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const day = (iso) => new Date(`${iso}T12:00:00+05:30`).toLocaleDateString('en-IN', { ...IST, weekday: 'long', day: 'numeric', month: 'long' });
const t12 = (hhmm) => (hhmm ? new Date(`2026-01-01T${hhmm}:00+05:30`).toLocaleTimeString('en-IN', { ...IST, hour: 'numeric', minute: '2-digit' }) : '');
const BTN = { minHeight: 44 };

function useLink(api, token) {
  const [d, setD] = useState(null);
  const [st, setSt] = useState({});
  useEffect(() => { http(`${api}/check`, { method: 'POST', body: { token } }).then(setD, (e) => setSt({ error: e.message })); }, [api, token]);
  const act = async (path, body, said) => {
    setSt({ busy: true });
    try { setD(await http(`${api}/${path}`, { method: 'POST', body: { token, ...body } })); setSt({ said }); return true; } catch (e) { setSt({ error: e.message }); return false; }
  };
  return { d, st, act };
}

function Where({ s, t }) {
  return (
    <span className="small" style={{ overflowWrap: 'anywhere' }}>
      {s.place && <>{s.place}{s.map && <> · <a href={s.map} target="_blank" rel="noreferrer">{t.map}</a></>}</>}
      {s.place && s.link && ' · '}
      {s.link && <a href={s.link} target="_blank" rel="noreferrer">{t.online}</a>}
    </span>
  );
}

function Reason({ label, onSend, onBack, busy, t, testid }) {
  const [v, setV] = useState('');
  return (
    <div className="stack g8">
      <label className="field stack g4"><span className="label">{label}</span><input className="input" value={v} maxLength={300} onChange={(e) => setV(e.target.value)} data-testid={`${testid}-why`} /></label>
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ink" style={BTN} disabled={busy || v.trim().length < 3} onClick={() => onSend(v)} data-testid={`${testid}-send`}>{t.send}</button>
        <button type="button" className="btn btn-ghost" style={BTN} onClick={onBack}>{t.back}</button>
      </div>
    </div>
  );
}

export function Book({ token }) {
  const { d, st, act } = useLink('/api/public/trust/book', token);
  const [mode, setMode] = useState('');
  const t = L[d?.lang] || L.en;
  if (!d) return st.error ? <p role="alert" className="error" data-testid="bk-error">{st.error}</p> : <p className="muted">{t.checking}</p>;
  const m = d.mine;
  return (
    <div className="stack g16" data-testid="bk">
      <p style={{ margin: 0 }}><strong>{d.role}</strong> · {d.company}</p>
      {m && (
        <div className="mcard mcard-tight stack g8" data-testid="bk-mine">
          <span className="label">{t.booked}</span>
          <strong data-testid="bk-mine-at">{when(m.at)} IST · {m.minutes} min{m.round ? ` · ${m.round}` : ''}</strong>
          <Where s={m} t={t} />
          {m.cantSent ? <p className="small" role="status" data-testid="bk-cant-done" style={{ margin: 0 }}>{t.cantDone}</p>
            : m.canChange ? <span className="xs muted">{t.until} {when(m.changeUntil)}. {d.open.length > 0 && t.change}</span>
              : <span className="xs muted">{t.locked.replace('{h}', d.changeHours)}</span>}
          {!m.cantSent && !m.past && mode === '' && (
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              {m.canChange ? <button type="button" className="btn btn-outline btn-sm" style={BTN} onClick={() => setMode('cancel')} data-testid="bk-cancel">{t.cancel}</button>
                : <button type="button" className="btn btn-outline btn-sm" style={BTN} onClick={() => setMode('cant')} data-testid="bk-cant">{t.cant}</button>}
            </div>
          )}
          {mode === 'cancel' && <Reason t={t} label={t.why} busy={st.busy} testid="bk-cancel" onBack={() => setMode('')} onSend={async (v) => { if (await act('cancel', { reason: v })) setMode(''); }} />}
          {mode === 'cant' && <Reason t={t} label={t.why} busy={st.busy} testid="bk-cant" onBack={() => setMode('')} onSend={async (v) => { if (await act('cant', { reason: v })) setMode(''); }} />}
        </div>
      )}
      {!d.allowed ? <p className="muted" data-testid="bk-closed">{t.closed}</p> : (!m || m.canChange) && (
        <div className="stack g8">
          <h2 className="h4" style={{ margin: 0 }}>{t.pick}</h2>
          {d.open.length === 0 ? <p className="muted small" data-testid="bk-none" style={{ margin: 0 }}>{t.none}</p> : (
            <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {d.open.map((s) => (
                <li key={s.id} className="mcard mcard-tight row g8" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }} data-testid="bk-slot">
                  <span className="stack g4" style={{ minWidth: 0 }}><strong className="small">{when(s.at)} IST · {s.minutes} min</strong><Where s={s} t={t} /></span>
                  <button type="button" className="btn btn-signal btn-sm" style={BTN} disabled={st.busy} onClick={() => act('pick', { slot: s.id })} data-testid="bk-pick">{t.book}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {st.error && <p role="alert" className="error" data-testid="bk-error">{st.error}</p>}
      <span className="xs muted">{t.expires} {when(d.expiresAt)}.</span>
    </div>
  );
}

export function Join({ token }) {
  const { d, st, act } = useLink('/api/public/trust/join', token);
  const [mode, setMode] = useState('');
  const t = L[d?.lang] || L.en;
  if (!d) return st.error ? <p role="alert" className="error" data-testid="jn-error">{st.error}</p> : <p className="muted">{t.checking}</p>;
  const open = d.status === 'accepted' || d.status === 'joined';
  return (
    <div className="stack g16" data-testid="jn">
      <div className="mcard mcard-tight stack g8">
        <span className="label">{t.joinTitle}</span>
        <strong data-testid="jn-when">{day(d.joinDate)}{d.time ? ` · ${t12(d.time)}` : ''}</strong>
        <span className="small">{d.role} · {d.company}</span>
        {d.place && <span className="small" style={{ overflowWrap: 'anywhere' }}>{d.place}{d.map && <> · <a href={d.map} target="_blank" rel="noreferrer">{t.directions}</a></>}</span>}
      </div>
      {st.said && <p role="status" className="small" data-testid="jn-said" style={{ margin: 0 }}>{t[st.said]}</p>}
      {d.joined ? <p data-testid="jn-joined">{t.joinedDone}</p> : open && d.stage !== 'before' ? (
        <button type="button" className="btn btn-signal" style={{ ...BTN, alignSelf: 'flex-start' }} disabled={st.busy} onClick={() => act('act', { action: 'joined' }, 'joinedDone')} data-testid="jn-joined-btn">{t.joined}</button>
      ) : open && d.stage === 'before' && mode === '' && (
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-signal" style={BTN} disabled={st.busy} onClick={() => act('act', { action: 'yes' }, 'coming')} data-testid="jn-yes">{t.yes}</button>
          <button type="button" className="btn btn-outline" style={BTN} onClick={() => setMode('resched')} data-testid="jn-resched">{t.resched}</button>
        </div>
      )}
      {mode === 'resched' && <Reason t={t} label={t.reschedWhy} busy={st.busy} testid="jn-resched" onBack={() => setMode('')} onSend={async (v) => { if (await act('act', { action: 'reschedule', reason: v }, 'reschedDone')) setMode(''); }} />}
      {d.face?.needed && <a className="btn btn-outline" style={{ ...BTN, alignSelf: 'flex-start' }} href={d.face.url} data-testid="jn-selfie">{t.selfie}</a>}
      {st.error && <p role="alert" className="error" data-testid="jn-error">{st.error}</p>}
    </div>
  );
}

export function CompanyJoin({ token }) {
  const { d, st, act } = useLink('/api/public/trust/cjoin', token);
  const [mode, setMode] = useState('');
  if (!d) return st.error ? <p role="alert" className="error" data-testid="cj-error">{st.error}</p> : <p className="muted">Checking the link…</p>;
  const said = d.joined?.company;
  return (
    <div className="stack g16" data-testid="cj">
      <p style={{ margin: 0 }}><strong>{d.candidate || 'Your new hire'}</strong> · {d.role} · joining {day(d.joinDate)}</p>
      {said === true && <p role="status" data-testid="cj-done">Thanks: marked as joined.</p>}
      {said === false && <p role="status" data-testid="cj-done">Thanks: marked as didn’t join{d.dropReason ? ` (${d.dropReason})` : ''}.</p>}
      {said === undefined && !d.canAnswer && <p className="muted">You can answer on the joining day.</p>}
      {said === undefined && d.canAnswer && mode === '' && (
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-signal" style={BTN} disabled={st.busy} onClick={() => act('act', { joined: true })} data-testid="cj-yes">Joined</button>
          <button type="button" className="btn btn-outline" style={BTN} onClick={() => setMode('no')} data-testid="cj-no">Didn’t join</button>
        </div>
      )}
      {mode === 'no' && <Reason t={L.en} label="What happened? (kept with the record)" busy={st.busy} testid="cj-no" onBack={() => setMode('')} onSend={async (v) => { if (await act('act', { joined: false, reason: v })) setMode(''); }} />}
      <span className="xs muted">This feeds the candidate’s reliability record on Nm7. You can correct it later in Hire &gt; Offers.</span>
      {st.error && <p role="alert" className="error" data-testid="cj-error">{st.error}</p>}
    </div>
  );
}
