// Profile & settings -> Verify with DigiLocker (Vetting Trust T2). Only for people who get Vetting Trust (useTrustOn in
// MeSettings); lazy. GET /api/me/trust/documents.
//   1. Needs the "Documents (DigiLocker / KYC)" consent (Privacy & consent card; it tells us with a `trust-consent` event).
//   2. Pick documents -> "Verify with DigiLocker" -> the vendor's DigiLocker page (the candidate approves there) -> back to
//      /me/settings?dl=<request> -> we ask the vendor. The test provider shows its own approve dialog instead.
//   3. The list: each document with its badge ("Verified via DigiLocker" + date), or plainly why a person is checking
//      it (a name that differs: fix the profile name and check again, or explain). Remove one; take back the consent
//      to delete all.
// We never fetch or keep Aadhaar. English only for now.
import { useCallback, useEffect, useState } from 'react';
import { Dialog, useToast } from '../../../components/ui';
import { http } from '../../../services/http';
import { MeCard } from '../kit';
import { IcCheck, IcUser } from '../../../components/icons';

const fmt = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const TONE = { verified: 'mchip-ok', review: 'mchip-warn', not_cleared: 'mchip-bad', expired: 'mchip-neutral' };
const SESSION = {
  pending: 'Waiting for DigiLocker. Once you have allowed it there, press “Check now”.',
  denied: 'DigiLocker said you did not allow it, so nothing was fetched.',
  expired: 'The DigiLocker request timed out. Start again.',
  failed: 'DigiLocker couldn’t be reached. Please try again in a few minutes.',
};

function Doc({ d, profileName, onChange, busy, setBusy }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [explain, setExplain] = useState(false);
  const [ask, setAsk] = useState(false);
  const act = async (path, opts, msg) => {
    setBusy(d.id);
    try { onChange(await http(`/api/me/trust/documents/${d.id}${path}`, opts)); if (msg) toast(msg); } catch (x) { toast(x.message); } finally { setBusy(''); }
  };
  return (
    <li className="mitem" data-testid={`dl-doc-${d.kind}`} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <span className="mitem-main" style={{ minWidth: 0, flex: '1 1 260px' }}>
        <span className="mitem-title">{d.title}{d.test ? <span className="xs faint"> (test document)</span> : null}</span>
        <span className="mitem-meta" style={{ overflowWrap: 'anywhere' }}>{d.summary}</span>
        <span className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <span className={`mchip ${TONE[d.state]}`} data-testid="dl-state">{d.state === 'verified' ? <><IcCheck size={14} /> </> : ''}{d.stateText}{d.state === 'verified' ? `, ${fmt(d.fetchedAt)}` : ''}</span>
          {d.state === 'verified' && d.verifyUntil && <span className="xs faint">Verify again by {fmt(d.verifyUntil)}</span>}
        </span>
        {d.state !== 'verified' && d.reasons.length > 0 && (
          <span className="small" role="status" data-testid="dl-why" style={{ overflowWrap: 'anywhere' }}>
            {d.reasons.join(' ')}{d.nameOnDocument ? ` DigiLocker says “${d.nameOnDocument}”; your profile says “${profileName}”.` : ''} Nobody is turned away because of this: a person at Nm7 looks at it, and companies just don’t see this badge until then.
          </span>
        )}
        {d.decisionNote && d.state !== 'verified' && <span className="small">Nm7: {d.decisionNote}</span>}
        {d.note && <span className="xs faint">Your note: {d.note}</span>}
        {(d.state === 'review' || d.state === 'not_cleared') && (
          <span className="row g8" style={{ flexWrap: 'wrap' }}>
            {d.nameOnDocument && <a className="btn btn-outline btn-sm" href="#s-profile" style={{ minHeight: 44 }}>Fix my profile name</a>}
            {d.nameOnDocument && <button type="button" className="btn btn-outline btn-sm" style={{ minHeight: 44 }} disabled={busy === d.id} onClick={() => act('/recheck', { method: 'POST' }, 'Checked again')} data-testid="dl-recheck">Check the name again</button>}
            <button type="button" className="btn btn-outline btn-sm" style={{ minHeight: 44 }} onClick={() => setExplain((v) => !v)} aria-expanded={explain} data-testid="dl-explain-open">Explain</button>
          </span>
        )}
        {explain && (
          <form className="stack g8" onSubmit={(e) => { e.preventDefault(); act('/explain', { method: 'POST', body: { note } }, 'Thanks: a person at Nm7 will read it').then(() => setExplain(false)); }}>
            <label className="field stack g4"><span className="label">Tell the reviewer (for example, why the names differ)</span>
              <textarea className="input" rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} data-testid="dl-explain" /></label>
            <div><button type="submit" className="btn btn-signal btn-sm" style={{ minHeight: 44 }} disabled={note.trim().length < 3 || busy === d.id} data-testid="dl-explain-send">Send</button></div>
          </form>
        )}
      </span>
      <span className="mitem-side">
        <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 44 }} onClick={() => setAsk(true)} aria-label={`Remove ${d.title}`} data-testid="dl-remove">Remove</button>
      </span>
      {ask && (
        <Dialog showTitle title={`Remove ${d.title}?`} onClose={() => setAsk(false)}>
          <div className="stack g12">
            <p className="small" style={{ margin: 0 }}>We delete what we kept from it and its badge. You can fetch it again from DigiLocker later.</p>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ink" style={{ minHeight: 44 }} onClick={() => { setAsk(false); act('', { method: 'DELETE' }, 'Removed'); }} data-testid="dl-remove-confirm">Remove</button>
              <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} onClick={() => setAsk(false)}>Keep it</button>
            </div>
          </div>
        </Dialog>
      )}
    </li>
  );
}

export default function DigiLockerCard() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState(['dl', 'class10', 'class12', 'degree', 'pan']);
  const [busy, setBusy] = useState('');
  const [mock, setMock] = useState(null); // the test provider's "DigiLocker" for this request id
  const load = useCallback(() => http('/api/me/trust/documents').then(setD, (x) => setErr(x.message)), []);
  const check = useCallback(async (id) => {
    setBusy('check');
    try { setD(await http(`/api/me/trust/documents/sessions/${id}/check`, { method: 'POST' })); } catch (x) { toast(x.message); } finally { setBusy(''); }
  }, [toast]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get('dl');
    if (id) { // back from DigiLocker
      q.delete('dl'); q.delete('dlmock');
      window.history.replaceState(null, '', `${window.location.pathname}${q.toString() ? `?${q}` : ''}${window.location.hash}`);
      check(id);
    } else load();
    const on = () => load();
    window.addEventListener('trust-consent', on);
    return () => window.removeEventListener('trust-consent', on);
  }, [load, check]);
  if (err) return <MeCard as="section" id="s-docs" className="acc-sec" label="Verify with DigiLocker" icon={<IcUser />} title="Verify with DigiLocker"><p className="error" role="alert">{err}</p></MeCard>;
  if (!d) return null;
  const start = async () => {
    setBusy('start');
    try {
      const r = await http('/api/me/trust/documents/sessions', { method: 'POST', body: { kinds: pick } });
      if (r.mock) { setMock(r.id); await load(); } else window.location.assign(r.url);
    } catch (x) { toast(x.message); } finally { setBusy(''); }
  };
  const mockAnswer = async (allow) => {
    const id = mock; setMock(null); setBusy('check');
    try {
      const r = await http(`/api/me/trust/documents/sessions/${id}/mock-approve`, { method: 'POST', body: { allow } });
      setD(r);
      toast(r.session?.status === 'done' ? `${r.session.fetched} document${r.session.fetched === 1 ? '' : 's'} verified` : 'Nothing was fetched');
    } catch (x) { toast(x.message); } finally { setBusy(''); }
  };
  const s = d.session;
  const toggle = (k) => setPick((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  return (
    <MeCard as="section" id="s-docs" className="acc-sec" label="Verify with DigiLocker" icon={<IcUser />} title="Verify with DigiLocker"
      sub="Fetch your driving licence, Class 10 and 12, degree or PAN from DigiLocker. Companies then see a “Verified via DigiLocker” badge. We never fetch or keep your Aadhaar." testid="dl-card">
      {!d.provider.ready ? <p className="small" role="status" style={{ margin: 0 }} data-testid="dl-off">DigiLocker isn’t connected yet. Please check back later.</p>
        : !d.consent ? (
          <p className="small" role="status" style={{ margin: 0 }} data-testid="dl-consent">
            First turn on <strong>Documents (DigiLocker / KYC)</strong> in <a href="#s-consent">Privacy & consent</a>. It explains what we keep and for how long.
          </p>
        ) : (
          <div className="stack g8">
            <fieldset className="stack g4" style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="label">Which documents? We fetch only these.</legend>
              <span className="row g12" style={{ flexWrap: 'wrap' }}>
                {d.kinds.map((k) => (
                  <label key={k.key} className="row g4 small" style={{ minHeight: 44, alignItems: 'center' }}>
                    <input type="checkbox" checked={pick.includes(k.key)} onChange={() => toggle(k.key)} data-testid={`dl-pick-${k.key}`} />{k.title}
                  </label>
                ))}
              </span>
            </fieldset>
            <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} disabled={!pick.length || !!busy} onClick={start} data-testid="dl-start">Verify with DigiLocker</button>
              {d.provider.test && <span className="xs faint">Test mode: no real documents are fetched.</span>}
            </div>
            <p className="xs faint" style={{ margin: 0 }}>You sign in to DigiLocker on its own page and choose to share. We keep only what a badge needs (for example licence class and validity, board and year, “PAN verified”), never the files, your Aadhaar or your full PAN.</p>
          </div>
        )}
      {s && SESSION[s.status] && (
        <div className="row g8" role="status" style={{ flexWrap: 'wrap', alignItems: 'center' }} data-testid="dl-session">
          <span className="small">{SESSION[s.status]}</span>
          {s.status === 'pending' && <button type="button" className="btn btn-outline btn-sm" style={{ minHeight: 44 }} disabled={!!busy} onClick={() => (s.mock ? setMock(s.id) : check(s.id))} data-testid="dl-check">{s.mock ? 'Open the test DigiLocker' : 'Check now'}</button>}
        </div>
      )}
      {s?.status === 'done' && s.missing?.length > 0 && <p className="xs faint" style={{ margin: 0 }} data-testid="dl-missing">Not found in your DigiLocker: {s.missing.map((k) => d.kinds.find((x) => x.key === k)?.title || k).join(', ')}.</p>}
      {d.documents.length > 0 && (
        <ul className="mlist" aria-label="My verified documents" data-testid="dl-docs">
          {d.documents.map((x) => <Doc key={x.id} d={x} profileName={d.profileName} onChange={setD} busy={busy} setBusy={setBusy} />)}
        </ul>
      )}
      {mock && (
        <Dialog showTitle title="Test DigiLocker" onClose={() => setMock(null)}>
          <div className="stack g12" data-testid="dl-mock">
            <p className="small" style={{ margin: 0 }}>This stands in for DigiLocker while it isn’t connected. Nothing real is fetched: test documents in your profile name are used.</p>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} onClick={() => mockAnswer(true)} data-testid="dl-mock-allow">Allow</button>
              <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} onClick={() => mockAnswer(false)} data-testid="dl-mock-deny">Don’t allow</button>
            </div>
          </div>
        </Dialog>
      )}
    </MeCard>
  );
}
