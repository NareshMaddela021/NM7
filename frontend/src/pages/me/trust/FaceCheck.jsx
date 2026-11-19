// Vetting Trust T3: the ID + live selfie check (a dialog). Opened before the AI interview or a skill check when the
// server answers `face_check_needed`, from Profile & settings (FaceCard.jsx), and for the joining-day check from an
// accepted offer (mode "joining"). Lazy: it lives in its own chunk next to the page that opens it.
//   1. The "Selfie and face match" consent (T1), with its plain text, if not given yet.
//   2. Identity only: pick driving licence or PAN card (never Aadhaar) and take a photo of it (the phone's back camera,
//      or a file).
//   3. The front camera: one photo looking straight, then a short prompt from the server (turn left / right, smile) and
//      two more photos while the person does it. The photos go to /api/me/trust/face (memory only on the server, then
//      to the face-check partner); nothing is kept in the browser either.
//   4. The result: verified; or didn't pass, with the reason and the tries left; or a person at Nm7 checks it.
// Always a way out: "I can't use the camera" asks for a manual check (a video call with the Nm7 team), also when the
// camera is blocked or missing. Nobody is turned away by this check. English only for now.
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../../components/ui';
import { http } from '../../../services/http';
import { IcCheck } from '../../../components/icons';

const API = '/api/me/trust/face';
const SHOT_MS = [1200, 2400]; // the two photos taken while the person follows the prompt
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

function b64OfDataUrl(u) { return u.slice(u.indexOf(',') + 1); }

function readFile(file) {
  return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => bad(new Error('read')); r.readAsDataURL(file); });
}

/** The card photo as base64: small JPEG / PNG as it is, anything else drawn smaller as a JPEG. */
async function cardImage(file) {
  if (file.size <= 1_500_000 && /^image\/(jpeg|png)$/.test(file.type)) return b64OfDataUrl(await readFile(file));
  const url = await readFile(file);
  const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('img')); i.src = url; });
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return b64OfDataUrl(c.toDataURL('image/jpeg', 0.85));
}

function grab(video) {
  const w = 480;
  const h = Math.round(w * ((video.videoHeight || 360) / (video.videoWidth || 480)));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(video, 0, 0, w, h);
  return b64OfDataUrl(c.toDataURL('image/jpeg', 0.85));
}

const CAMERA_HELP = {
  NotAllowedError: 'Your browser blocked the camera. Allow the camera for nm7.si (the camera or lock icon next to the address), then press “Try again”.',
  NotFoundError: 'We couldn’t find a camera on this device.',
  NotReadableError: 'Another app is using the camera. Close it, then press “Try again”.',
};

function Manual({ d, which, offerId, onSent, onBack }) {
  const [reason, setReason] = useState(which === 'joining' ? 'failed' : 'no_camera');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { onSent(await http(`${API}/manual`, { method: 'POST', body: { reason, note, which, offerId } })); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <form className="stack g12" onSubmit={send} data-testid="fc-manual">
      <p className="small" style={{ margin: 0 }}>A person at Nm7 will check it’s you instead, usually on a short video call. We’ll email you to fix a time. This never counts against you.</p>
      <label className="field stack g4"><span className="label">Why do you need another way?</span>
        <select className="input" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="fc-manual-reason">
          {d.manualReasons.map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}
        </select></label>
      <label className="field stack g4"><span className="label">Anything we should know? (optional)</span>
        <textarea className="input" rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} data-testid="fc-manual-note" /></label>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy} data-testid="fc-manual-send">{busy ? 'Sending…' : 'Ask for a manual check'}</button>
        {onBack && <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={onBack}>Back</button>}
      </div>
    </form>
  );
}

/** The dialog. mode: "identity" (step: interview | skill_check | settings) or "joining" (offerId). */
export default function FaceCheck({ mode = 'identity', step = 'settings', offerId = null, onDone, onClose }) {
  const joining = mode === 'joining';
  const [d, setD] = useState(null);
  const [stage, setStage] = useState('load');
  const [err, setErr] = useState('');
  const [doc, setDoc] = useState('dl');
  const [card, setCard] = useState(null); // { b64, url } of the card photo (memory only)
  const [prompt, setPrompt] = useState(null); // { key, text }
  const [phase, setPhase] = useState(''); // '', 'look', 'move', 'sending'
  const [camErr, setCamErr] = useState('');
  const video = useRef(null);
  const stream = useRef(null);

  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => () => stop(), []);
  useEffect(() => () => { if (card?.url) URL.revokeObjectURL(card.url); }, [card]);

  const route = (x) => {
    setD(x);
    const s = x.state;
    if (!x.provider.ready) return setStage('off');
    if (!x.consent) return setStage('consent');
    if (joining) {
      const c = s.continuity;
      if (c?.offerId === offerId && c.status === 'same') return setStage('done');
      if (c?.offerId === offerId && ['review', 'not_same'].includes(c.status)) return setStage('person');
      if (s.status !== 'verified' || !s.hasReference) return setStage('noref');
      return setStage(c?.offerId === offerId && c.status === 'retry' ? 'result' : 'camera');
    }
    if (s.status === 'verified') return setStage('done');
    if (['review', 'not_cleared'].includes(s.status)) return setStage('person');
    return setStage(s.status === 'retry' && card ? 'result' : 'id');
  };
  useEffect(() => { http(API).then(route, (x) => { setErr(x.message); setStage('error'); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const agree = async () => {
    setErr('');
    try { await http('/api/me/trust/consents/selfie_face', { method: 'POST' }); window.dispatchEvent(new Event('trust-consent')); route(await http(API)); } catch (x) { setErr(x.message); }
  };

  const openCamera = async () => {
    setCamErr(''); setErr(''); setPrompt(null); // a new movement each time: the old one is no longer valid
    if (!navigator.mediaDevices?.getUserMedia) { setCamErr('This browser can’t open the camera. Try Chrome or Safari, or ask for a manual check.'); return; }
    try {
      stop();
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (video.current) { video.current.srcObject = stream.current; await video.current.play().catch(() => {}); }
      setPrompt(await http(`${API}/challenge`, { method: 'POST' }));
    } catch (x) {
      stop();
      setCamErr(CAMERA_HELP[x?.name] || x?.message || 'We couldn’t open your camera.');
    }
  };
  useEffect(() => { if (stage === 'camera') openCamera(); else stop(); }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const takeCard = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr('');
    try { setCard({ b64: await cardImage(f), url: URL.createObjectURL(f) }); } catch { setErr('That photo didn’t work. Please take it again.'); }
  };

  const shoot = async () => {
    const v = video.current;
    if (!v || !prompt) return;
    setErr(''); setPhase('look');
    const frames = [grab(v)];
    setPhase('move');
    let last = 0;
    for (const at of SHOT_MS) { await wait(at - last); last = at; frames.push(grab(v)); }
    setPhase('sending');
    stop();
    try {
      const x = joining
        ? await http(`${API}/joining/${offerId}`, { method: 'POST', body: { frames, challenge: prompt.key } })
        : await http(`${API}/check`, { method: 'POST', body: { step, docType: doc, idImage: card.b64, frames, challenge: prompt.key } });
      setD(x); setPhase('');
      const ok = joining ? x.state.continuity?.status === 'same' : x.state.status === 'verified';
      const st = joining ? x.state.continuity?.status : x.state.status;
      setStage(ok ? 'done' : st === 'review' ? 'person' : 'result');
    } catch (x) {
      setPhase('');
      if (x.code === 'aadhaar_refused') { setCard(null); setStage('id'); }
      else if (x.code === 'with_a_person') { route(await http(API)); return; }
      setErr(x.message);
      if (x.code !== 'aadhaar_refused') setStage('result-error');
    }
  };

  const s = d?.state;
  const c = s?.continuity;
  const left = joining ? c?.triesLeft : s?.triesLeft;
  const title = joining ? 'Joining day: is it you?' : 'Quick check: is it really you?';
  const sentManual = (x) => { setD(x); setStage('person'); };
  const review = joining ? c?.review : s?.review;

  return (
    <Dialog showTitle title={title} onClose={() => { stop(); onClose?.(); }}>
      <div className="stack g12" data-testid="fc-dialog" style={{ minWidth: 0 }}>
        {stage === 'load' && <p className="small" role="status">Loading…</p>}
        {stage === 'error' && <p className="error" role="alert">{err}</p>}
        {stage === 'off' && <p className="small" data-testid="fc-off">The face check isn’t connected yet. Please try again later.</p>}

        {stage === 'consent' && (
          <div className="stack g12" data-testid="fc-consent">
            <strong className="small">{d.consentTitle}</strong>
            <p className="small" style={{ margin: 0, overflowWrap: 'anywhere' }} data-testid="fc-consent-text">{d.consentText}</p>
            {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}{/date of birth|age/i.test(err) ? ' (Profile & settings, Privacy & consent)' : ''}</p>}
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} onClick={agree} data-testid="fc-agree">I agree</button>
              <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={() => setStage('manual')}>I can’t use a camera</button>
            </div>
          </div>
        )}

        {stage === 'id' && (
          <div className="stack g12" data-testid="fc-id">
            <p className="small" style={{ margin: 0 }}>{step === 'interview' ? 'Before your AI interview' : step === 'skill_check' ? 'Before your skill check' : 'Once'}: a photo of your ID card, then a live selfie. About a minute. We don’t keep the photos.</p>
            <fieldset className="vet-fs" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">Which card?</legend>
              <div className="row g8" style={{ flexWrap: 'wrap' }}>
                {d.docTypes.map((t) => (
                  <label key={t.key} className={`vet-pill ${doc === t.key ? 'on' : ''}`} style={{ minHeight: 44 }}>
                    <input type="radio" name="fc-doc" value={t.key} checked={doc === t.key} onChange={() => setDoc(t.key)} data-testid={`fc-doc-${t.key}`} /> <span>{t.title}</span>
                  </label>
                ))}
              </div>
              <span className="xs muted">We never take Aadhaar. Please use your driving licence or PAN card.</span>
            </fieldset>
            <label className="field stack g4"><span className="label">Photo of the front of your card: flat, all four corners in, no glare</span>
              <input type="file" accept="image/jpeg,image/png" capture="environment" className="input" onChange={takeCard} data-testid="fc-card" /></label>
            {card && <img src={card.url} alt="Your card photo" style={{ maxWidth: '100%', maxHeight: 180, objectFit: 'contain', alignSelf: 'flex-start', borderRadius: 8 }} data-testid="fc-card-preview" />}
            {err && <p className="error" role="alert" style={{ margin: 0 }} data-testid="fc-error">{err}</p>}
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} disabled={!card} onClick={() => { setErr(''); setStage('camera'); }} data-testid="fc-next">Next: selfie</button>
              <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={() => setStage('manual')} data-testid="fc-other-way">I can’t use a camera</button>
            </div>
          </div>
        )}

        {stage === 'camera' && (
          <div className="stack g12" data-testid="fc-camera">
            <p className="small" style={{ margin: 0 }}>Face the light, take off sunglasses or a mask, and keep only your face in the picture. Press <strong>Start</strong> and follow the instruction.</p>
            <div style={{ position: 'relative', width: '100%', maxWidth: 360, alignSelf: 'center' }}>
              <video ref={video} playsInline muted autoPlay aria-label="Your camera" data-testid="fc-video"
                style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', transform: 'scaleX(-1)', borderRadius: 12, background: '#111', display: 'block' }} />
              <span aria-hidden="true" style={{ position: 'absolute', inset: '8% 22%', border: '3px dashed rgba(255,255,255,.75)', borderRadius: '50%' }} />
            </div>
            <p className="small" role="status" aria-live="assertive" data-testid="fc-prompt" style={{ margin: 0, fontWeight: 600, minHeight: '1.5em' }}>
              {phase === 'look' ? 'Look straight at the camera…' : phase === 'move' ? prompt?.text : phase === 'sending' ? 'Checking…' : prompt ? 'Ready when you are.' : ''}
            </p>
            {camErr && (
              <div className="stack g8" role="alert" data-testid="fc-camera-error">
                <p className="error" style={{ margin: 0 }}>{camErr}</p>
                <div className="row g8" style={{ flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} onClick={openCamera} data-testid="fc-camera-retry">Try again</button>
                  <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} onClick={() => setStage('manual')} data-testid="fc-camera-manual">Ask for a manual check instead</button>
                </div>
              </div>
            )}
            {!camErr && (
              <div className="row g8" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-signal btn-lg" style={{ minHeight: 44 }} disabled={!prompt || !!phase} onClick={shoot} data-testid="fc-shoot">{phase ? 'Hold still…' : 'Start'}</button>
                <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={() => setStage('manual')} data-testid="fc-other-way">I can’t use a camera</button>
              </div>
            )}
          </div>
        )}

        {(stage === 'result' || stage === 'result-error') && (
          <div className="stack g12" data-testid="fc-result">
            {stage === 'result-error' ? <p className="error" role="alert" style={{ margin: 0 }} data-testid="fc-error">{err}</p> : (
              <p className="small" role="status" style={{ margin: 0 }} data-testid="fc-retry">
                It didn’t pass this time. {(joining ? c?.lastReason : s?.lastReason) || ''} {left > 0 ? `You can try ${left} more time${left === 1 ? '' : 's'}.` : ''}
              </p>
            )}
            {stage === 'result' && ((joining ? c?.status : s?.status) === 'review') ? null : (
              <div className="row g8" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} onClick={() => { setErr(''); setStage(joining || card ? 'camera' : 'id'); }} data-testid="fc-again">Try again</button>
                {!joining && <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} onClick={() => { setCard(null); setStage('id'); }}>Take the card photo again</button>}
                <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={() => setStage('manual')} data-testid="fc-other-way">Ask for a manual check</button>
              </div>
            )}
            <p className="xs muted" style={{ margin: 0 }}>Tips: good light on your face, no hat or sunglasses, the card flat and sharp. Nobody is turned away by this check.</p>
          </div>
        )}

        {stage === 'person' && (
          <div className="stack g12" data-testid="fc-person">
            <p className="small" role="status" style={{ margin: 0 }}>
              {(joining ? c?.status : s?.status) === 'review' || (joining ? c?.status : s?.status) === 'retry'
                ? 'A person at Nm7 is checking it, usually within one working day. If we need a short video call, we’ll email you. Nobody is turned away because of this.'
                : 'A person at Nm7 couldn’t confirm it yet.'}
            </p>
            {review && <p className="xs muted" style={{ margin: 0 }} data-testid="fc-person-why">{review.reasonText}{review.decisionNote ? ` Nm7: ${review.decisionNote}` : ''}</p>}
            {['not_cleared', 'not_same'].includes(joining ? c?.status : s?.status) && <button type="button" className="btn btn-signal" style={{ minHeight: 44, alignSelf: 'flex-start' }} onClick={() => setStage('manual')} data-testid="fc-other-way">Ask for a manual check (video call)</button>}
            <button type="button" className="btn btn-ghost" style={{ minHeight: 44, alignSelf: 'flex-start' }} onClick={() => onClose?.()}>Close</button>
          </div>
        )}

        {stage === 'noref' && (
          <div className="stack g12" data-testid="fc-noref">
            <p className="small" style={{ margin: 0 }}>There is no earlier ID + selfie check to compare with. A person at Nm7 can check it’s you on a short video call instead.</p>
            <button type="button" className="btn btn-signal" style={{ minHeight: 44, alignSelf: 'flex-start' }} onClick={() => setStage('manual')}>Ask for a manual check</button>
          </div>
        )}

        {stage === 'manual' && d && <Manual d={d} which={joining ? 'joining' : 'identity'} offerId={offerId} onSent={sentManual} onBack={() => route(d)} />}

        {stage === 'done' && (
          <div className="stack g12" data-testid="fc-done">
            <p className="small" role="status" style={{ margin: 0 }}><strong><IcCheck size={14} /> {joining ? 'Same person at joining: confirmed.' : 'ID + selfie verified.'}</strong> {joining ? 'Have a great first day!' : 'Thank you. We didn’t keep the photos.'}</p>
            <button type="button" className="btn btn-signal" style={{ minHeight: 44, alignSelf: 'flex-start' }} onClick={() => onDone?.(d.state)} data-testid="fc-continue">{step === 'interview' ? 'Start the interview' : step === 'skill_check' ? 'Start the test' : 'Done'}</button>
          </div>
        )}
        {d?.provider?.test && stage !== 'load' && <span className="xs faint">Test provider: no real face check.</span>}
      </div>
    </Dialog>
  );
}
