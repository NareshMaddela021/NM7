// "My drive day": the drive days a student's college placed them in — company, round, room and time — and check-in:
// scan the room's QR (the phone camera, or the camera here when the browser can read QR codes) or type its 6-digit
// code. Only slots the student is in; no location tracking.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Spinner } from '../../components/ui';
import { StatusBadge } from '../org/Drives';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';

/** The camera, when the browser can read QR codes (Android Chrome can). Calls onCode(slotId, code) once. */
function Scanner({ onCode, onClose }) {
  const video = useRef(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let stream; let timer; let off = false;
    (async () => {
      try {
        const det = new window.BarcodeDetector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (off) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (off) return;
          try {
            const [hit] = await det.detect(video.current);
            const u = hit && new URL(hit.rawValue);
            const c = u?.searchParams.get('c');
            if (c && /^\d{6}$/.test(c)) { onCode(u.searchParams.get('s'), c); return; }
          } catch { /* not a QR yet */ }
          timer = setTimeout(tick, 300);
        };
        tick();
      } catch { setErr('The camera isn’t available here. Use your phone’s camera app to scan, or type the code.'); }
    })();
    return () => { off = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack g8">
      {err ? <span className="small" role="alert">{err}</span> : <video ref={video} muted playsInline style={{ width: '100%', maxWidth: 360, borderRadius: 8, background: '#000' }} aria-label="Camera" />}
      <button type="button" className="link-btn xs" onClick={onClose} style={{ alignSelf: 'flex-start' }}>Close the camera</button>
    </div>
  );
}

export function CheckinBox({ onDone }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [scan, setScan] = useState(false);
  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
  const send = async (slotId, c) => {
    setBusy(true); setMsg(null); setScan(false);
    try {
      const r = await http('/api/me/checkin', { method: 'POST', body: { slotId: slotId || undefined, code: c } });
      setMsg({ ok: true, text: `Checked in: ${r.company} · ${r.round} · ${r.room}${r.status === 'late' ? ' (marked late)' : ''}` });
      setCode(''); onDone?.();
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  return (
    <div className="well stack g8" data-testid="checkin-box">
      <strong className="small">Check in</strong>
      <span className="xs muted">Scan the QR shown in your room, or type the 6-digit code under it.</span>
      <form className="row g8" style={{ flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); send(null, code); }}>
        <input className="input mono" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required aria-label="Room code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ width: 130, letterSpacing: 3 }} data-testid="checkin-code-input" />
        <button type="submit" className="btn btn-ink" disabled={busy || code.length !== 6} data-testid="checkin-send">{busy && <Spinner />}Check in</button>
        {canScan && !scan && <button type="button" className="btn btn-outline" onClick={() => setScan(true)}>Scan QR</button>}
      </form>
      {scan && <Scanner onCode={send} onClose={() => setScan(false)} />}
      {msg && <span role={msg.ok ? 'status' : 'alert'} className={`small ${msg.ok ? '' : 'error'}`} data-testid="checkin-msg">{msg.text}</span>}
    </div>
  );
}

export default function MeDrive() {
  const [days, setDays] = useState(null);
  const [err, setErr] = useState('');
  const load = () => http('/api/me/drives').then(setDays, (e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  return (
    <div className="stack g20">
      <MeHead title="My drive day" sub="Your placement drive slots from your college: company, round, room and time." />
      {err && <p role="alert" className="error">{err}</p>}
      {!days ? <div className="row g8"><Spinner /> Loading…</div> : days.length === 0 ? <p className="small muted" data-testid="drive-none">No drive days for you yet. Your college adds them here.</p> : (
        <>
          <CheckinBox onDone={load} />
          {days.map((d) => (
            <section key={d.id} className="card stack g12" aria-label={d.name} data-testid="my-drive">
              <div className="stack g4"><strong>{d.name}</strong><span className="xs muted">{d.org} · {new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
              <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {d.slots.map((s) => (
                  <li key={s.id} className="row between g8" style={{ flexWrap: 'wrap', alignItems: 'center' }} data-testid="my-slot">
                    <span className="stack g4" style={{ minWidth: 0 }}><strong className="small">{s.company} · {s.round}</strong><span className="xs muted">{s.room} · {s.start}–{s.end}</span></span>
                    <StatusBadge s={s.status} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

/** /checkin?s=…&c=… — what the room's QR opens: checks in at once (after signing in) and shows the result. */
export function CheckinLink() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    const s = params.get('s'); const c = params.get('c');
    if (!c || !/^\d{6}$/.test(c)) { setMsg({ ok: false, text: 'This check-in link isn’t complete. Scan the QR again.' }); return; }
    http('/api/me/checkin', { method: 'POST', body: { slotId: s || undefined, code: c } })
      .then((r) => setMsg({ ok: true, text: `You’re checked in: ${r.company} · ${r.round} · ${r.room}${r.status === 'late' ? ' (marked late)' : ''}.` }), (e) => setMsg({ ok: false, text: e.message }));
  }, [params]);
  return (
    <main id="main" className="container stack g16" style={{ padding: '48px 16px', maxWidth: 520 }}>
      <h1 className="display h2">Drive day check-in</h1>
      {!msg ? <div className="row g8"><Spinner /> Checking you in…</div> : <p role={msg.ok ? 'status' : 'alert'} data-testid="checkin-result" className={msg.ok ? '' : 'error'}>{msg.text}</p>}
      <span className="row g8"><Link className="btn btn-outline" to="/me/drive">My drive day</Link>{msg && !msg.ok && <button type="button" className="btn btn-ink" onClick={() => nav('/me/drive')}>Type the code instead</button>}</span>
    </main>
  );
}
