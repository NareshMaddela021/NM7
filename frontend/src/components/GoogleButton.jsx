// "Continue with Google" (sign-in and sign-up pages). Renders nothing until the server reports a Google client ID
// (GET /api/public/site-flags → googleClientId; empty while Google sign-in is off). Then it loads Google Identity
// Services (accounts.google.com/gsi/client) only on this page, draws Google's own button, and sends the ID token to
// POST /api/auth/google as { credential, role, next }; the signed-in user goes to onDone, the same as email sign-in.
import { useEffect, useRef, useState } from 'react';
import { googleSignIn } from '../lib/auth';
import { loadSiteFlags } from '../lib/siteFlags';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
let gsi = null;
/** The Google script, added once per page load. */
function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!gsi) {
    gsi = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GSI_SRC; s.async = true; s.defer = true;
      s.onload = () => (window.google?.accounts?.id ? resolve(window.google) : reject(new Error('gsi')));
      s.onerror = () => { gsi = null; reject(new Error('gsi')); };
      document.head.appendChild(s);
    });
  }
  return gsi;
}

/** mode: 'signin' | 'signup' | 'link'; role: account type for a new account; next: where to go after; onDone(user).
 *  action: what to do with the credential instead of signing in (Settings → Connect Google); divider: the "or with
 *  email" line under the button; note: a short line under the button (the terms for a new account). */
export default function GoogleButton({ mode = 'signin', role, next, onDone, action = googleSignIn, divider = mode !== 'link', note }) {
  const [clientId, setClientId] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  const latest = useRef({ role, next, onDone, action });
  latest.current = { role, next, onDone, action };

  useEffect(() => {
    let dead = false;
    loadSiteFlags().then((f) => { if (!dead) setClientId(f.googleClientId || ''); });
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    if (!clientId) return undefined;
    let dead = false;
    loadGsi().then((google) => {
      if (dead || !box.current) return;
      google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          const { role: r, next: n, onDone: done, action: act } = latest.current;
          setErr(''); setBusy(true);
          try { done?.(await act({ credential, role: r, next: n })); } catch (e) { setErr(e.message || 'Google sign-in did not work. Please try again.'); } finally { setBusy(false); }
        },
      });
      google.accounts.id.renderButton(box.current, { type: 'standard', theme: 'outline', size: 'large', shape: 'rectangular', text: mode === 'link' ? 'signin_with' : mode === 'signup' ? 'signup_with' : 'continue_with', logo_alignment: 'center', width: Math.min(400, box.current.offsetWidth || 320) });
    }, () => { if (!dead) setErr(mode === 'link' ? 'Google could not load. Please try again later.' : 'Google sign-in could not load. Use your email below.'); });
    return () => { dead = true; };
  }, [clientId, mode]);

  if (!clientId) return null;
  return (
    <div className="stack g8" data-testid="google-button" data-mode={mode} aria-busy={busy || undefined}>
      <div ref={box} style={{ minHeight: 44, width: '100%' }} />
      {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
      {note && <span className="xs muted">{note}</span>}
      {divider && <span className="row g8 xs muted" aria-hidden="true" style={{ alignItems: 'center' }}><i style={{ flex: 1, borderTop: '1px solid var(--border)' }} />or with email<i style={{ flex: 1, borderTop: '1px solid var(--border)' }} /></span>}
    </div>
  );
}
