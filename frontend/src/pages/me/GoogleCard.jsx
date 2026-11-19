// Profile & settings → Sign-in methods: "Connect Google" / "Remove Google", and "Set a password" for an account made
// with Google. Lazy (its own chunk); shown only while Google sign-in is on (site flags → googleClientId) or Google is
// still connected. A Google-only account can't remove Google until it has a password (the server checks it too).
import { Suspense, lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner, useToast } from '../../components/ui';
import { reloadUser, useAuth } from '../../lib/auth';
import { loadSiteFlags } from '../../lib/siteFlags';
import { http } from '../../services/http';
import { MeCard } from './kit';

const GoogleButton = lazy(() => import('../../components/GoogleButton'));

// Here rather than in lib/auth.js, which is in every page's first download: the server answers with the account,
// then the signed-in user is read again so every page sees the change.
const linkGoogle = async ({ credential }) => { await http('/api/auth/google/link', { method: 'POST', body: { credential } }); return reloadUser(); };
const unlinkGoogle = async () => { await http('/api/auth/google', { method: 'DELETE' }); return reloadUser(); };

export const setPasswordHref = (email) => `/forgot-password?set=1&email=${encodeURIComponent(email || '')}`;

/** The card itself, without the Google script (vitest renders it). connect: the Connect button. */
export function GoogleCardView({ user, busy, err, onRemove, connect }) {
  const g = user.google;
  const last = g && !user.hasPassword; // Google is the only way to sign in
  return (
    <MeCard as="section" id="s-google" className="acc-sec" label="Sign-in methods" icon="🔐" title="Sign in with Google" sub={g ? 'You can sign in with Google or with your email and password.' : 'Sign in with one tap, without typing your password.'}>
      {g ? (
        <ul className="mlist">
          <li className="mitem">
            <span className="mitem-main"><span className="mitem-title">Connected to Google</span><span className="mitem-meta acc-google-email">{g.email}</span></span>
            <span className="mitem-side"><button type="button" className="btn btn-outline" onClick={onRemove} disabled={busy || last} aria-describedby={last ? 'g-last' : undefined}>{busy ? <Spinner /> : 'Remove Google'}</button></span>
          </li>
          {last && <li className="mitem" id="g-last"><span className="mitem-main"><span className="mitem-meta">Google is your only way to sign in. Set a password first, so you can still sign in after removing Google.</span></span><span className="mitem-side"><Link to={setPasswordHref(user.email)} className="btn btn-outline">Set a password</Link></span></li>}
        </ul>
      ) : (
        <div className="stack g8" style={{ maxWidth: 400 }}>{connect}</div>
      )}
      {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
    </MeCard>
  );
}

export default function GoogleCard() {
  const { user } = useAuth();
  const toast = useToast();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { let dead = false; loadSiteFlags().then((f) => { if (!dead) setOn(!!f.googleClientId); }); return () => { dead = true; }; }, []);
  if (!user || (!on && !user.google)) return null;
  const remove = async () => {
    setBusy(true); setErr('');
    try { await unlinkGoogle(); toast('Google removed. Sign in with your email and password.'); } catch (e) { setErr(e.message || 'Not removed. Please try again.'); } finally { setBusy(false); }
  };
  const connect = <Suspense fallback={null}><GoogleButton mode="link" action={linkGoogle} onDone={() => toast('Google connected')} /></Suspense>;
  return <GoogleCardView user={user} busy={busy} err={err} onRemove={remove} connect={connect} />;
}
