// "Share on WhatsApp": opens WhatsApp with a short message and the public resume link. The public link is opt-in:
// when it's off, a dialog explains it and turns it on (with hide phone / email) before sharing.
import { useState } from 'react';
import { Dialog, Spinner, useToast } from './ui';
import { useMe, saveShare } from '../lib/customerStore';
import { currentUser, LIVE } from '../lib/auth';
import { shareMessage, shareUrl, waShareUrl } from '../lib/shareLink';

const slugOf = (name) => (name || 'me').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'my-resume';
const WaIcon = () => <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3a.5.5 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.6a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.6-.3Z" /></svg>;

/** job: { role, company } from a job match (goes into the message). */
export default function ShareWhatsApp({ job, className = 'btn btn-outline', style, testid = 'share-wa' }) {
  const me = useMe();
  const toast = useToast();
  const [ask, setAsk] = useState(null);
  const [opts, setOpts] = useState({ hidePhone: true, hideEmail: true });
  const [busy, setBusy] = useState(false);
  if (LIVE && currentUser()?.role !== 'customer') return null; // guests: the link needs an account
  const sh = me.share || {};
  const link = shareUrl(sh);
  const wa = link ? waShareUrl(shareMessage(link, job)) : '';
  if (link && !ask && !busy) {
    return <a href={wa} target="_blank" rel="noopener noreferrer" className={className} style={{ gap: 6, ...style }} data-testid={testid}><WaIcon />Share on WhatsApp</a>;
  }
  const turnOn = async () => {
    setBusy(true);
    const base = sh.slug || slugOf(me.account?.name);
    try {
      try { await saveShare({ on: true, slug: base, ...opts }); } catch (e) {
        if (e.status !== 409) throw e;
        await saveShare({ on: true, slug: `${base}-${Math.random().toString(36).slice(2, 6)}`, ...opts }); // the name is taken
      }
      toast('Public link turned on');
    } catch (e) { toast(e.message || 'Not saved. Please try again.'); setAsk(null); } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className={className} style={{ gap: 6, ...style }} data-testid={testid} onClick={(e) => setAsk(e.currentTarget)}><WaIcon />Share on WhatsApp</button>
      {ask && (
        <Dialog title="Share your resume on WhatsApp" onClose={() => setAsk(null)} returnTo={ask}>
          {link && !busy ? (
            <div className="stack g12">
              <p className="small">Your public link is on: <span className="mono" style={{ overflowWrap: 'anywhere' }}>{link.replace('https://', '')}</span></p>
              <div className="row g8">
                <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-ink" style={{ gap: 6 }} data-testid="share-open-wa" onClick={() => setAsk(null)}><WaIcon />Open WhatsApp</a>
                <button type="button" className="btn btn-ghost" onClick={() => setAsk(null)}>Close</button>
              </div>
            </div>
          ) : (
          <div className="stack g12">
            <p className="small">To share on WhatsApp, turn on your public resume link. Anyone with the link can view your resume. ID numbers are never shown, search engines are asked not to list it, and you can turn it off any time in <strong>Share link</strong>.</p>
            <label className="row g8 small"><input type="checkbox" checked={opts.hidePhone} onChange={(e) => setOpts({ ...opts, hidePhone: e.target.checked })} data-testid="share-hide-phone" />Hide my phone number</label>
            <label className="row g8 small"><input type="checkbox" checked={opts.hideEmail} onChange={(e) => setOpts({ ...opts, hideEmail: e.target.checked })} data-testid="share-hide-email" />Hide my email</label>
            <div className="row g8">
              <button type="button" className="btn btn-ink" disabled={busy} onClick={turnOn} data-testid="share-turn-on">{busy && <Spinner />}Turn on link</button>
              <button type="button" className="btn btn-ghost" onClick={() => setAsk(null)}>Not now</button>
            </div>
          </div>
          )}
        </Dialog>
      )}
    </>
  );
}
