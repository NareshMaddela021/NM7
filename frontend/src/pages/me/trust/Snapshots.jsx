// Vetting Trust T8: optional webcam snapshots during a skill check or the AI interview. Only for people Vetting Trust is
// on for (trustOn) and only with the separate "webcam_snapshots" consent; never needed to take a test.
//   SnapshotChoice  in the start dialog: the plain consent text and one tick box ("Yes, take a few still photos").
//                   Ticking it gives the consent (POST /api/me/trust/consents/webcam_snapshots); unticking only skips
//                   this session (taking it back for good is in Profile & settings -> Privacy & consent).
//   useSnapshots    in the test / interview: asks the server for the plan (3–5 random moments), and at each moment
//                   opens the front camera for one still photo (320 px JPEG, no video, no audio), sends it and closes the
//                   camera at once. A blocked or missing camera just means no photo: the test carries on as normal.
//   SnapNote        the small "Webcam snapshots on: 1 of 4 photos taken" line, so it is never hidden.
import { useEffect, useState } from 'react';
import { http } from '../../../services/http';
import { trustOn } from '../../../lib/trustAccess';
import { IcCamera } from '../../../components/icons';

const API = '/api/me/trust/integrity/snapshots';
const skip = {}; // kind -> true: "not this time" (session only)

export function SnapshotChoice({ kind }) {
  const [d, setD] = useState(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    trustOn().then((t) => t && http(API).then((x) => { if (live) { setD(x); setOn(x.consent); skip[kind] = false; } }, () => {}));
    return () => { live = false; };
  }, [kind]);
  if (!d?.offer) return null;
  const change = async (v) => {
    setErr('');
    setOn(v); // at once (the box follows the tick); taken back below if the consent can't be saved
    skip[kind] = !v;
    if (v && !d.consent) {
      setBusy(true);
      try { await http('/api/me/trust/consents/webcam_snapshots', { method: 'POST' }); setD((x) => ({ ...x, consent: true })); } catch (x) { setErr(x.message); setOn(false); skip[kind] = true; }
      setBusy(false);
    }
  };
  return (
    <fieldset className="vet-fs" data-testid="snap-choice">
      <legend className="vet-legend">Optional: webcam snapshots</legend>
      <p className="xs muted" style={{ margin: 0 }} data-testid="snap-text">{d.text}</p>
      <label className="vet-check">
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => change(e.target.checked)} aria-label="Yes, take a few still photos" data-testid="snap-tick" />
        <span><strong>Yes, take a few still photos</strong><span className="xs muted" style={{ display: 'block' }}>{d.perSession} photos at random times. Leave it unticked and the {kind === 'interview' ? 'interview' : 'test'} works exactly the same.</span></span>
      </label>
      {d.consent && !on && <span className="xs muted">Skipped this time. To turn it off for good: Profile &amp; settings &gt; Privacy &amp; consent.</span>}
      {err && <p className="error" role="alert">{err}</p>}
    </fieldset>
  );
}

async function shoot(kind, ref) {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.srcObject = stream;
    await v.play();
    await new Promise((r) => setTimeout(r, 500)); // let the camera settle on one frame
    const c = document.createElement('canvas');
    c.width = 320; c.height = Math.round((320 * (v.videoHeight || 240)) / (v.videoWidth || 320));
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const image = c.toDataURL('image/jpeg', 0.7);
    return await http(API, { method: 'POST', body: { kind, ref, image } });
  } catch { return null; } finally { stream?.getTracks().forEach((t) => t.stop()); }
}

/** {taken, n} while snapshots are on for this session, else null. */
export function useSnapshots(kind, ref) {
  const [st, setSt] = useState(null);
  useEffect(() => {
    if (!ref || skip[kind]) return undefined;
    let live = true;
    const timers = [];
    trustOn().then((t) => {
      if (!t || !live) return;
      http(`${API}/plan`, { method: 'POST', body: { kind, ref } }).then((p) => {
        if (!live || !p.on) return;
        setSt({ taken: p.taken, n: p.n });
        p.dueInMs.forEach((ms) => timers.push(setTimeout(() => {
          shoot(kind, ref).then((r) => { if (r && live) setSt({ taken: r.taken, n: p.n }); });
        }, ms)));
      }, () => {});
    });
    return () => { live = false; timers.forEach(clearTimeout); };
  }, [kind, ref]);
  return st;
}

export function SnapNote({ st }) {
  if (!st) return null;
  return <span className="xs muted" role="status" data-testid="snap-status"><IcCamera size={14} /> Webcam snapshots on: {st.taken} of {st.n} still photos taken (no video, no sound)</span>;
}
