// "Share" for the public resume link, in any app (the phone's share sheet, or WhatsApp, LinkedIn, Telegram, Facebook,
// X, Email, Copy link): a short message and the link, nothing else. The public link is opt-in: when it's off, a dialog
// explains it and turns it on (with hide phone / email) before sharing.
import { useState } from 'react';
import { Dialog, Spinner, useToast } from './ui';
import { useMe, saveShare } from '../lib/customerStore';
import { currentUser, LIVE } from '../lib/auth';
import { shareText, shareUrl } from '../lib/shareLink';
import ShareButton, { ShareIcon, ShareOptions } from './ShareButton';

const slugOf = (name) => (name || 'me').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'my-resume';

/** job: { role, company } from a job match (goes into the message). */
export default function ShareResume({ job, className = 'btn btn-outline', style, testid = 'share-resume' }) {
  const me = useMe();
  const toast = useToast();
  const [ask, setAsk] = useState(null);
  const [opts, setOpts] = useState({ hidePhone: true, hideEmail: true });
  const [busy, setBusy] = useState(false);
  if (LIVE && currentUser()?.role !== 'customer') return null; // guests: the link needs an account
  const sh = me.share || {};
  const link = shareUrl(sh);
  const text = shareText(job);
  if (link && !ask && !busy) {
    return <ShareButton url={link} text={text} title="My resume" className={className} style={style} testid={testid} />;
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
      <button type="button" className={className} style={{ gap: 6, ...style }} data-testid={testid} onClick={(e) => setAsk(e.currentTarget)}><ShareIcon />Share</button>
      {ask && (
        <Dialog title="Share your resume" onClose={() => setAsk(null)} returnTo={ask}>
          {link && !busy ? (
            <div className="stack g12">
              <p className="small">Your public link is on: <span className="mono" style={{ overflowWrap: 'anywhere' }}>{link.replace('https://', '')}</span></p>
              <ShareOptions url={link} text={text} title="My resume" onDone={() => setAsk(null)} />
              <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setAsk(null)}>Close</button>
            </div>
          ) : (
          <div className="stack g12">
            <p className="small">To share your resume, turn on your public resume link. Anyone with the link can view your resume. ID numbers are never shown, search engines are asked not to list it, and you can turn it off any time in <strong>Share link</strong>.</p>
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
