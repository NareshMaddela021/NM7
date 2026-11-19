// Shareable resume link (nm7.si/r/<name>): on/off, which resume, hide phone, views.
// Also the public page that recruiters open.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useToast } from '../../components/ui';
import { Logo } from '../../components/Header';
import { useMe, setMe, getMe, saveShare } from '../../lib/customerStore';
import { LIVE, http } from '../../services/http';
import { Spinner } from '../../components/ui';
import { BarChart } from '../admin/AdminUI';
import ResumePreview from '../builder/ResumePreview';
import { MeHead } from './MeLayout';
import { ResumeThumb, designOf, downloadResume, fmtShort } from './shared';
import { Chip, Empty, FieldGroup, Stat } from './kit';
import '../../styles/me-resume.css';
import ShareResume from '../../components/ShareResume';
import { downloadQrPng, qrFileName } from '../../lib/qr';
import { namedUrl, shareUrl } from '../../lib/shareLink';

const DAY = 864e5;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const publicData = (d, share) => ({ ...d, personal: { ...d.personal, ...(share.hidePhone ? { phone: '' } : {}), ...(share.hideEmail ? { email: '' } : {}) } });

const times = (n) => (n === 1 ? 'once' : `${n} times`);

export default function MeShare() {
  const me = useMe();
  const toast = useToast();
  const sh = me.share;
  const [slug, setSlug] = useState(sh.slug);
  const [busy, setBusy] = useState(false);
  const set = async (patch, done) => {
    setBusy(true);
    try { await saveShare(patch); if (done) toast(done); } catch (e) { toast(e.message || 'Not saved. Please try again.'); if (patch.slug) setSlug(sh.slug); } finally { setBusy(false); }
  };
  const short = shareUrl(sh);
  const named = namedUrl(sh);
  const copy = async (u) => { try { await navigator.clipboard.writeText(u); toast('Link copied'); } catch { toast(`Copy this: ${u}`); } };
  const saveQr = async () => { try { await downloadQrPng(short, qrFileName(me.account?.name || 'My', 'resume')); toast('QR saved'); } catch (e) { toast(e.message); } };
  const days = Array.from({ length: 14 }, (_, i) => { const start = new Date(); start.setHours(0, 0, 0, 0); const t0 = start.getTime() - (13 - i) * DAY; return { label: fmtShort(t0), views: sh.views.filter((t) => t >= t0 && t < t0 + DAY).length }; });
  const okSlug = SLUG_RE.test(slug);
  const shown = me.resumes.find((r) => r.id === sh.resumeId) || me.resumes.find((r) => r.active) || me.resumes[0];
  const week = sh.views.filter((t) => Date.now() - t < 7 * DAY).length;
  return (
    <>
      <MeHead title="Share link" sub="One link that always shows your latest resume — for WhatsApp, emails and your LinkedIn. Only you see the view count." />
      <div className="mgrid-2">
        <section className="mcard mcard-accent sh-hero" aria-label="Your link">
          <label className="sh-switch">
            <span className="mstack" style={{ gap: 4 }}>
              <span className="mrow" style={{ gap: 8 }}><strong className="sh-state">Link is {sh.on ? 'on' : 'off'}</strong><Chip tone={sh.on ? 'ok' : 'neutral'}>{sh.on ? 'Anyone with the link' : 'Private'}</Chip></span>
              <span className="mitem-meta">{sh.on ? 'Anyone with the link can view and download your resume.' : 'Nobody can open the link right now.'}</span>
            </span>
            <input type="checkbox" role="switch" className="sh-toggle" checked={sh.on} disabled={busy} onChange={(e) => set({ on: e.target.checked, slug: sh.slug || slug }, e.target.checked ? 'Link turned on' : 'Link turned off')} />
          </label>
          {sh.on ? (
            <>
              <div className="sh-link">
                <span className="mkicker">Short link</span>
                <span className="sh-url mono" data-testid="share-short">{short.replace('https://', '')}</span>
                {sh.short && <span className="mitem-meta">Also works: <span className="mono">{named.replace('https://', '')}</span></span>}
              </div>
              <div className="mrow" style={{ gap: 8 }}>
                <button type="button" className="btn btn-signal" onClick={() => copy(short)}>Copy</button>
                <Link to={`/r/${sh.short || sh.slug}`} className="btn btn-outline">Open</Link>
                <ShareResume testid="share-page-share" />
                <button type="button" className="btn btn-outline" onClick={saveQr} data-testid="share-qr">Download QR (PNG)</button>
              </div>
              <span className="xs faint">Search engines are asked not to list this page. ID numbers are never shown.</span>
            </>
          ) : <Empty compact shape="handshake" title="Turn the link on to share">Recruiters open it on any phone. You can turn it off any time.</Empty>}
        </section>
        <aside className="mcard sh-preview" aria-label="What people see">
          <span className="mkicker">What people see</span>
          {shown && <ResumeThumb data={shown.data} width={220} label={`Preview of ${shown.name} resume`} />}
          <span className="mitem-meta">{shown?.name}{sh.hidePhone ? ' · phone hidden' : ''}{sh.hideEmail ? ' · email hidden' : ''}</span>
        </aside>
      </div>
      {sh.on && (
        <section className="mcard" aria-label="Link settings">
          <h2 className="mcard-title">Link settings</h2>
          <FieldGroup title="Your link’s name" help="Change it if you want an easy name. The old link stops working.">
            <form className="sh-slug full" onSubmit={(e) => { e.preventDefault(); if (okSlug && !busy) set({ slug }, 'Link name changed — the old link stops working'); }}>
              <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="sl" className="label">Link name</label><input id="sl" className="input" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} aria-invalid={!okSlug} />{!okSlug && <span className="xs" style={{ color: 'var(--danger)' }}>3–40 letters, numbers or dashes.</span>}</div>
              <button type="submit" className="btn btn-outline" disabled={busy || !okSlug || slug === sh.slug}>{busy ? <Spinner /> : 'Change'}</button>
            </form>
          </FieldGroup>
          <FieldGroup title="What the link shows" help="Pick the resume and hide what you don’t want strangers to see.">
            <div className="field"><label htmlFor="sr" className="label">Resume shown</label><select id="sr" className="input" value={sh.resumeId || me.resumes.find((r) => r.active)?.id || ''} disabled={busy} onChange={(e) => set({ resumeId: e.target.value })}>{me.resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
            <span className="mstack sh-privacy" style={{ gap: 4 }}>
              <label className="sh-check"><input type="checkbox" checked={!!sh.hidePhone} disabled={busy} onChange={(e) => set({ hidePhone: e.target.checked })} />Hide my phone number on the link</label>
              <label className="sh-check"><input type="checkbox" checked={!!sh.hideEmail} disabled={busy} onChange={(e) => set({ hideEmail: e.target.checked })} data-testid="share-hide-email-page" />Hide my email on the link</label>
            </span>
          </FieldGroup>
        </section>
      )}
      <section className="mcard" aria-label="Views">
        <h2 className="mcard-title">Who opened it</h2>
        <div className="mgrid-3">
          <Stat label="This week" value={week} sub={`Viewed ${times(week)} this week`} />
          <Stat label="In total" value={sh.viewCount ?? sh.views.length} sub={`${sh.viewCount ?? sh.views.length} in total`} />
        </div>
        <BarChart title="Views per day · last 14 days" data={days} series={[{ key: 'views', label: 'Views', color: 'var(--viz-1)' }]} height={140} />
        <span className="xs faint">We count visits, not who visited.</span>
      </section>
    </>
  );
}

/** Live: the published resume from the server, for anyone with the link (it counts the view). */
function LivePublicResume({ slug }) {
  const toast = useToast();
  const [st, setSt] = useState({ loading: true });
  useEffect(() => {
    let off = false;
    http(`/api/public/resumes/${encodeURIComponent(slug)}`).then((r) => !off && setSt({ r }), (e) => !off && setSt({ error: e }));
    return () => { off = true; };
  }, [slug]);
  return (
    <PublicFrame>
      {st.loading && <div className="row g12 muted" role="status"><Spinner /> Opening the resume…</div>}
      {st.error && (st.error.status === 404
        ? <Off />
        : <div className="card stack g8" role="alert"><h1 className="display" style={{ fontSize: 26 }}>We couldn’t open this resume</h1><p className="muted">{st.error.message}</p></div>)}
      {st.r && (
        <>
          <div className="row between g8"><h1 className="display" style={{ fontSize: 26 }}>{st.r.name || 'Resume'}</h1>
            {st.r.canDownload !== false && <button type="button" className="btn btn-ink" onClick={async () => { if (await downloadResume(st.r.data, 'pdf', undefined, slug)) toast('PDF ready'); }}>Download PDF</button>}</div>
          {st.r.verified?.length > 0 && (
            <div className="row g8" style={{ flexWrap: 'wrap' }} aria-label="Skills verified on Nm7" data-testid="pub-verified">
              {st.r.verified.map((v) => <span key={v.skill} className="badge b-success" title="Skill check passed and project done on Nm7">✓ Skill verified: {v.skill} · {new Date(v.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>)}
            </div>
          )}
          <ResumePreview data={st.r.data} design={designOf(st.r.data)} />
          <span className="xs faint" style={{ textAlign: 'center' }}>Made with Nm7 · <Link to="/">Build yours free</Link></span>
        </>
      )}
    </PublicFrame>
  );
}
function PublicFrame({ children }) {
  return (
    <>
      <header className="site-header"><div className="bar"><Logo /><span className="xs muted">Resume shared via Nm7</span></div></header>
      <main id="main" className="container stack g16" style={{ maxWidth: 860, padding: '24px 16px 64px' }}>{children}</main>
    </>
  );
}
const Off = () => <div className="card stack g8"><h1 className="display" style={{ fontSize: 26 }}>This resume link is turned off</h1><p className="muted">Ask the person to send you a new link.</p><Link to="/">Build your own resume on Nm7</Link></div>;

export function PublicResume() {
  const { slug } = useParams();
  return LIVE ? <LivePublicResume slug={slug} /> : <PreviewPublicResume slug={slug} />;
}

function PreviewPublicResume({ slug }) {
  const me = useMe();
  const toast = useToast();
  const sh = me.share;
  const ok = sh.on && (sh.slug === slug || (!!sh.short && sh.short === slug));
  useEffect(() => { if (ok) setMe((s) => ({ share: { ...s.share, views: [...s.share.views, Date.now()] } })); }, [ok]); // count one view per visit
  const r = me.resumes.find((x) => x.id === sh.resumeId) || me.resumes[0];
  return (
    <>
      <header className="site-header"><div className="bar"><Logo /><span className="xs muted">Resume shared via Nm7</span></div></header>
      <main className="container stack g16" style={{ maxWidth: 860, padding: '24px 16px 64px' }}>
        {!ok ? (
          <div className="card stack g8"><h1 className="display" style={{ fontSize: 26 }}>This resume link is turned off</h1><p className="muted">Ask the person to send you a new link.</p><Link to="/">Build your own resume on Nm7</Link></div>
        ) : (
          <>
            <div className="row between g8"><h1 className="display" style={{ fontSize: 26 }}>{r.data.personal.name}</h1>
              <button type="button" className="btn btn-ink" onClick={async () => { if (await downloadResume(publicData(r.data, getMe().share), 'pdf', undefined, slug)) toast('PDF ready'); }}>Download PDF</button></div>
            <ResumePreview data={publicData(r.data, sh)} design={designOf(r.data)} />
            <span className="xs faint" style={{ textAlign: 'center' }}>Made with Nm7 · <Link to="/">Build yours free</Link></span>
          </>
        )}
      </main>
    </>
  );
}
