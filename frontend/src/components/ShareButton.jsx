// One "Share" button for every app. On a phone (touch screen with the Web Share API) it opens the phone's own share
// sheet, so people pick any app; on a computer, or where Web Share isn't there, a small menu: WhatsApp, LinkedIn,
// Telegram, Facebook, X, Email and Copy link. Each tap is counted per channel with no personal data
// (POST /api/public/shares {channel}: a per-day counter, nothing else). Shared job links show a preview card
// (the API's /api/jobs/<slug>/preview for link-preview robots, see vercel.json).
import { useState } from 'react';
import { Dialog, useToast } from './ui';
import { useLang } from '../lib/i18n';
import { http, LIVE } from '../services/http';

const WORDS = {
  en: { share: 'Share', title: 'Share', copy: 'Copy link', copied: 'Link copied', copyFail: 'Could not copy. Select the link and copy it.', email: 'Email', close: 'Close' },
  te: { share: 'షేర్', title: 'షేర్ చేయండి', copy: 'లింక్ కాపీ', copied: 'లింక్ కాపీ అయింది', copyFail: 'కాపీ కాలేదు. లింక్‌ను ఎంచుకుని కాపీ చేయండి.', email: 'ఈమెయిల్', close: 'మూసివేయండి' },
  hi: { share: 'शेयर', title: 'शेयर करें', copy: 'लिंक कॉपी करें', copied: 'लिंक कॉपी हो गया', copyFail: 'कॉपी नहीं हुआ। लिंक चुनकर कॉपी करें।', email: 'ईमेल', close: 'बंद करें' },
};

export const CHANNELS = ['whatsapp', 'linkedin', 'telegram', 'facebook', 'x', 'email', 'copy'];

/** Counts one share for this channel (native, whatsapp, …, copy). Never shows an error; nothing personal is sent. */
export function trackShare(channel) {
  if (!LIVE) return;
  http('/api/public/shares', { method: 'POST', body: { channel } }).catch(() => {});
}

/** The web address that shares this link in each app (text: the message without the link). */
export function shareTarget(channel, { url, text = '', title = '' }) {
  const e = encodeURIComponent;
  const msg = text ? `${text} ${url}` : url;
  switch (channel) {
    case 'whatsapp': return `https://wa.me/?text=${e(msg)}`;
    case 'linkedin': return `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}`;
    case 'telegram': return `https://t.me/share/url?url=${e(url)}${text ? `&text=${e(text)}` : ''}`;
    case 'facebook': return `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`;
    case 'x': return `https://x.com/intent/tweet?url=${e(url)}${text ? `&text=${e(text)}` : ''}`;
    case 'email': return `mailto:?subject=${e(title || text || url)}&body=${e(msg)}`;
    default: return '';
  }
}

/** Phones with a share sheet (a touch screen without a mouse, and the Web Share API). */
export function canShareNatively(nav = typeof navigator !== 'undefined' ? navigator : null, win = typeof window !== 'undefined' ? window : null) {
  if (!nav || typeof nav.share !== 'function') return false;
  return !!win?.matchMedia?.('(pointer: coarse)').matches && !win.matchMedia('(any-pointer: fine)').matches;
}

/** The Share tap: the phone's share sheet when there is one (counted as "native"), else `openMenu()`. A sheet closed
 *  without sharing does nothing; a sheet that fails opens the menu. */
export async function shareOrMenu({ url, text, title }, openMenu, nav = typeof navigator !== 'undefined' ? navigator : null, win = typeof window !== 'undefined' ? window : null, track = trackShare) {
  if (canShareNatively(nav, win)) {
    try {
      await nav.share({ title: title || undefined, text: text || undefined, url });
      track('native');
      return 'native';
    } catch (err) {
      if (err?.name === 'AbortError') return 'closed';
    }
  }
  openMenu();
  return 'menu';
}

const NAMES = { whatsapp: 'WhatsApp', linkedin: 'LinkedIn', telegram: 'Telegram', facebook: 'Facebook', x: 'X' };

/** The seven ways to share, as one list (in the menu and inside other dialogs). */
export function ShareOptions({ url, text, title, onDone }) {
  const [, lang] = useLang();
  const w = WORDS[lang] || WORDS.en;
  const toast = useToast();
  const [note, setNote] = useState('');
  const copy = async () => {
    trackShare('copy');
    try {
      await navigator.clipboard.writeText(url);
      setNote(w.copied);
      toast?.(w.copied);
    } catch { setNote(w.copyFail); }
  };
  return (
    <div className="stack g8">
      <ul className="share-list" data-testid="share-options">
        {CHANNELS.map((c) => (
          <li key={c}>
            {c === 'copy' ? (
              <button type="button" className="btn btn-outline" onClick={copy} data-testid="share-copy">{w.copy}</button>
            ) : (
              <a className="btn btn-outline" href={shareTarget(c, { url, text, title })} {...(c === 'email' ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                onClick={() => { trackShare(c); onDone?.(); }} data-testid={`share-${c}`}>{c === 'email' ? w.email : NAMES[c]}</a>
            )}
          </li>
        ))}
      </ul>
      <span className="mono xs muted" style={{ overflowWrap: 'anywhere' }} data-testid="share-url">{url.replace(/^https:\/\//, '')}</span>
      {note && <span className="xs" role="status" data-testid="share-note">{note}</span>}
    </div>
  );
}

/** "Share": the phone's share sheet, else the menu. */
export default function ShareButton({ url, text = '', title = '', className = 'btn btn-outline', style, testid = 'share', label, icon = true }) {
  const [, lang] = useLang();
  const w = WORDS[lang] || WORDS.en;
  const [open, setOpen] = useState(null);
  const click = async (e) => {
    const btn = e.currentTarget;
    await shareOrMenu({ url, text, title }, () => setOpen(btn));
  };
  return (
    <>
      <button type="button" className={className} style={{ gap: 6, ...style }} onClick={click} aria-haspopup="dialog" data-testid={testid}>
        {icon && <ShareIcon />}{label || w.share}
      </button>
      {open && (
        <Dialog title={w.title} showTitle onClose={() => setOpen(null)} returnTo={open}>
          <ShareOptions url={url} text={text} title={title} onDone={() => setOpen(null)} />
        </Dialog>
      )}
    </>
  );
}

export const ShareIcon = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
  </svg>
);
