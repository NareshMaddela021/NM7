// Profile & settings → ID + selfie check (Vetting Trust T3). Only for people who get Vetting Trust (useTrustOn in
// MeSettings); lazy. GET /api/me/trust/face. Shows where the person stands (not done / verified / with a person, the
// joining-day check), when the check is asked for (before the AI interview, before a skill check), and opens the camera
// check (FaceCheck.jsx) or a manual check. Taking back the "Selfie and face match" consent deletes it all.
import { useCallback, useEffect, useState } from 'react';
import { http } from '../../../services/http';
import { MeCard } from '../kit';
import FaceCheck from './FaceCheck';

const fmt = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const TONE = { verified: 'mchip-ok', review: 'mchip-warn', retry: 'mchip-warn', not_cleared: 'mchip-bad', none: 'mchip-neutral' };

export default function FaceCard() {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => http('/api/me/trust/face').then(setD, () => setD(null)), []);
  useEffect(() => {
    load();
    window.addEventListener('trust-consent', load);
    return () => window.removeEventListener('trust-consent', load);
  }, [load]);
  if (!d) return null;
  const s = d.state;
  const when = [d.required.interview && 'before the AI interview', d.required.skillCheck && 'before a skill check'].filter(Boolean).join(' and ');
  return (
    <MeCard as="section" id="s-face" className="acc-sec" label="ID + selfie check" icon="🙂" title="ID + selfie check" testid="fc-card"
      sub={`A photo of your driving licence or PAN card and a live selfie, to show it’s really you${when ? ` (asked ${when})` : ''}. Companies only see “ID + selfie verified”, never your photos. We never take Aadhaar.`}>
      {!d.provider.ready ? <p className="small" role="status" style={{ margin: 0 }}>The face check isn’t connected yet.</p> : (
        <div className="stack g8">
          <span className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <span className={`mchip ${TONE[s.status]}`} data-testid="fc-state">{s.status === 'verified' ? '✓ ' : ''}{s.statusText}{s.status === 'verified' && s.verifiedAt ? `, ${fmt(s.verifiedAt)}` : ''}{s.test ? ' (test)' : ''}</span>
            {s.continuity && <span className={`mchip ${s.continuity.status === 'same' ? 'mchip-ok' : 'mchip-warn'}`} data-testid="fc-same">{s.continuity.statusText}</span>}
          </span>
          {s.review?.status === 'open' && <span className="small" data-testid="fc-card-review">{s.review.reasonText} A person at Nm7 is looking at it; nobody is turned away because of this.</span>}
          {s.review?.decisionNote && s.status !== 'verified' && <span className="small">Nm7: {s.review.decisionNote}</span>}
          {!d.consent && <p className="small" style={{ margin: 0 }} data-testid="fc-card-consent">It needs <strong>Selfie and face match</strong> in <a href="#s-consent">Privacy & consent</a>; you can also agree when you start.</p>}
          {s.status !== 'verified' && (
            <div><button type="button" className="btn btn-outline" style={{ minHeight: 44 }} onClick={() => setOpen(true)} data-testid="fc-open">{['review', 'not_cleared'].includes(s.status) ? 'See details' : 'Do the check now'}</button></div>
          )}
        </div>
      )}
      {open && <FaceCheck mode="identity" step="settings" onClose={() => { setOpen(false); load(); }} onDone={() => { setOpen(false); load(); }} />}
    </MeCard>
  );
}
