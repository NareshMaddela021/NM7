// "Watch the 2-minute demo" on /for-orgs (never on the job-seeker home page). Light on page speed: until someone
// presses play there is only the small poster image (about 45 KB, its box sized up front so nothing shifts; not
// lazy-loaded, since on a phone it is the largest thing in view and lazy loading only delayed it) and a play button.
// Pressing it puts in the real <video> (controls, playsinline, preload="none", no autoplay on its own and never muted
// autoplay) and starts it, because the person asked. Phones under 600 px get the vertical (9:16) file and its own
// opening frame as poster. Captions are burned into the videos. "Download for WhatsApp" saves the vertical file.
import { useEffect, useRef, useState } from 'react';
import { fileName } from '../../lib/fileName';
import { translate } from '../../lib/i18n';

export const DEMO = {
  wide: '/media/nm7-demo.mp4',
  tall: '/media/nm7-demo-vertical.mp4',
  poster: '/media/nm7-demo-poster.jpg',
  posterTall: '/media/nm7-demo-poster-vertical.jpg', // the vertical video's opening frame
};
const PHONE = '(max-width: 599px)';
const phoneNow = () => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE).matches;

/** t / lang: the page's language (/for-orgs has the language switch); English when left out. */
export default function DemoVideo({ t = (k) => translate('en', k), lang }) {
  const [phone, setPhone] = useState(phoneNow);
  const [playing, setPlaying] = useState(false);
  const video = useRef(null);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE);
    if (!mq) return undefined;
    const on = () => setPhone(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  useEffect(() => { if (playing) video.current?.play?.().catch(() => { /* the controls are there to press */ }); }, [playing]);
  const src = phone ? DEMO.tall : DEMO.wide;
  const poster = phone ? DEMO.posterTall : DEMO.poster;
  const box = { position: 'relative', width: '100%', aspectRatio: phone ? '9 / 16' : '16 / 9', maxHeight: phone ? '80vh' : undefined, margin: phone ? '0 auto' : undefined, borderRadius: 16, overflow: 'hidden', background: '#0b1020' };
  if (phone) box.maxWidth = 'calc(80vh * 9 / 16)';
  return (
    <section className="stack g12" aria-labelledby="demo-h" data-testid="demo-video" lang={lang}>
      <h2 id="demo-h" className="display h3">{t('orgs.demo.title')}</h2>
      <div style={box}>
        {playing ? (
          <video key={src} ref={video} src={src} poster={poster} controls playsInline preload="none" data-testid="demo-player"
            aria-label={t('orgs.demo.video')} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#0b1020' }} />
        ) : (
          <button type="button" onClick={() => setPlaying(true)} data-testid="demo-play" aria-label={t('orgs.demo.play')}
            style={{ all: 'unset', cursor: 'pointer', position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <img src={poster} alt="" decoding="async" width={phone ? 720 : 1280} height={phone ? 1280 : 720}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            <span aria-hidden="true" style={{ position: 'relative', width: 76, height: 76, borderRadius: '50%', background: 'rgba(255,255,255,0.92)', display: 'grid', placeItems: 'center', boxShadow: '0 6px 24px rgba(0,0,0,0.35)' }}>
              <svg width="30" height="30" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#111" /></svg>
            </span>
          </button>
        )}
      </div>
      <div className="row g12" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="xs muted">{t('orgs.demo.note')}</span>
        <a className="btn btn-outline" href={DEMO.tall} download={fileName(['Nm7', 'demo', 'WhatsApp'], 'mp4')} data-testid="demo-whatsapp">{t('orgs.demo.wa')}</a>
      </div>
    </section>
  );
}
