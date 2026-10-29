// Profile & settings > Delete account (live site): what is removed, a code by email, then 7 days to undo before
// everything is erased. Organization Owners transfer ownership first.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, Spinner, useToast } from '../../components/ui';
import { http } from '../../services/http';

const REMOVED = [
  'your resumes and their versions, cover letters and applications',
  'certificates, resume health alerts and ATS checks',
  'job posts you matched, tailoring and interview practice',
  'your LinkedIn link, PDF text and checks',
  'your public resume link (it stops at once)',
  'group memberships, offers, alumni profile and messages',
  'your name on codes you used',
];
const day = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function DeleteAccount() {
  const toast = useToast();
  const [st, setSt] = useState(null);
  const [open, setOpen] = useState(null);
  const [step, setStep] = useState('explain');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = () => http('/api/me/account/deletion').then(setSt, () => setSt({ requested: false, ownerOf: [] }));
  useEffect(() => { load(); }, []);
  const go = async (fn) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  if (!st) return null;
  if (st.requested) {
    return (
      <div className="well stack g8" role="status" data-testid="delete-pending" style={{ borderColor: 'var(--danger)' }}>
        <strong className="small">Your account will be deleted on {day(st.eraseAt)}.</strong>
        <span className="xs muted">Until then you can use it as normal (your public link is off). Changed your mind?</span>
        <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => go(async () => { await http('/api/me/account/deletion', { method: 'DELETE' }); toast('Deletion cancelled — your account stays'); await load(); })} data-testid="delete-undo">Undo — keep my account</button>
      </div>
    );
  }
  return (
    <>
      <div className="row between g8"><span className="small" style={{ color: 'var(--danger)' }}>Delete my account and all my data.</span><button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={(e) => { setStep('explain'); setCode(''); setErr(''); setOpen(e.currentTarget); }} data-testid="delete-open">Delete account</button></div>
      {open && (
        <Dialog showTitle title="Delete your account?" onClose={() => setOpen(null)} returnTo={open}>
          <div className="stack g12">
            {st.ownerOf.length > 0 ? (
              <>
                <span className="small" role="alert">You own {st.ownerOf.join(', ')} on Nm7. Transfer ownership first (Org &gt; Team), then come back.</span>
                <Link to="/org" className="btn btn-outline" style={{ alignSelf: 'flex-start' }}>Go to my organization</Link>
              </>
            ) : step === 'explain' ? (
              <>
                <span className="small">We remove:</span>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{REMOVED.map((x) => <li key={x}>{x}</li>)}</ul>
                <span className="small muted">We keep only what the law needs for paid orders (amounts and invoices, for GST), no longer linked to you. You have 7 days to undo. Download your data first if you want a copy.</span>
                {err && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{err}</span>}
                <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => go(async () => { await http('/api/me/account/deletion/code', { method: 'POST' }); setStep('code'); })} data-testid="delete-send">{busy && <Spinner />}Email me a code</button>
              </>
            ) : (
              <form className="stack g12" onSubmit={(e) => { e.preventDefault(); go(async () => { await http('/api/me/account/deletion', { method: 'POST', body: { code } }); setOpen(null); toast('Your account will be deleted in 7 days'); await load(); }); }}>
                <span className="small">We sent a 6-digit code to your email.</span>
                <div className="field" style={{ maxWidth: 200 }}><label className="label" htmlFor="del-code">Code</label><input id="del-code" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} data-testid="delete-code" /></div>
                {err && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{err}</span>}
                <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start', background: 'var(--danger)', borderColor: 'var(--danger)' }} disabled={busy || code.length !== 6} data-testid="delete-confirm">Delete my account in 7 days</button>
              </form>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
