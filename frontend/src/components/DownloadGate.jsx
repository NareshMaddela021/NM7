// The two download pop-ups: "Create a free account to download your resume" (guests) and
// "Unlock downloads - Rs 99 one-time" (signed in, payments on, nothing paid yet). Opened by exportFile().
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, Spinner, useToast } from './ui';
import { closeGate, onGate, rememberDownload } from '../lib/downloads';
import { createOrder, pay } from '../services/api';
import { reloadMe } from '../lib/customerStore';

const rs = (n) => `Rs ${Number(n).toLocaleString('en-IN')}`;

export default function DownloadGateHost() {
  const [g, setG] = useState(null);
  useEffect(() => onGate(setG), []);
  if (!g) return null;
  return g.reason === 'guest' ? <GuestGate g={g} /> : <UnlockGate g={g} />;
}

function GuestGate({ g }) {
  const nav = useNavigate();
  const go = (path) => { rememberDownload(g.format, g.what); closeGate(); nav(`${path}?next=${encodeURIComponent('/builder')}`); };
  return (
    <Dialog title="Create a free account to download your resume" onClose={closeGate}>
      <strong style={{ fontSize: 20 }}>Create a free account to download your resume</strong>
      <p className="muted" style={{ margin: 0 }}>Your resume is saved — nothing is lost. It moves into your new account, and your {g.format === 'docx' ? 'Word file' : 'PDF'} downloads straight after.</p>
      <div className="stack g8">
        <button type="button" className="btn btn-ink btn-lg" onClick={() => go('/signup')}>Create account</button>
        <button type="button" className="btn btn-outline" onClick={() => go('/login')}>I already have an account - Sign in</button>
      </div>
      <button type="button" className="link-btn xs" style={{ alignSelf: 'center' }} onClick={closeGate}>Keep editing</button>
    </Dialog>
  );
}

function UnlockGate({ g }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const price = g.price ?? 99;
  const unlock = async () => {
    setBusy(true); setErr('');
    try {
      const order = await createOrder({ planId: 'diy' }); // the server sets the price
      await pay(order); // Razorpay's own window, then the server confirms the payment
      reloadMe();
      closeGate();
      toast('Downloads unlocked for your account');
      await g.retry().catch(() => {});
    } catch (e) {
      setErr(e.code === 'dismissed' ? e.message : e.message || 'Payment didn’t go through. You haven’t been charged — please try again.');
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Unlock downloads - ${rs(price)} one-time`} onClose={() => !busy && closeGate()}>
      <strong style={{ fontSize: 20 }}>Unlock downloads - {rs(price)} one-time</strong>
      <p className="muted" style={{ margin: 0 }}>Pay once and every download stays unlocked on your account.</p>
      <ul className="stack g8" style={{ margin: 0, paddingLeft: 18 }}>
        <li>PDF &amp; Word downloads</li>
        <li>All templates</li>
        <li>AI line fixes</li>
      </ul>
      {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
      <div className="stack g8">
        <button type="button" className="btn btn-ink btn-lg" onClick={unlock} disabled={busy} aria-busy={busy}>{busy && <Spinner />}{busy ? 'Waiting for your payment…' : `Pay ${rs(price)}`}</button>
        <button type="button" className="btn btn-outline" onClick={closeGate} disabled={busy}>Not now</button>
      </div>
      <span className="xs faint" style={{ textAlign: 'center' }}>UPI, card or netbanking · GST invoice emailed</span>
    </Dialog>
  );
}
