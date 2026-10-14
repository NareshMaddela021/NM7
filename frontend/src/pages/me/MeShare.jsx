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
import { designOf, downloadResume, fmtShort } from './shared';

const DAY = 864e5;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const publicData = (d, share) => (share.hidePhone ? { ...d, personal: { ...d.personal, phone: '' } } : d);

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
  const url = `nm7.si/r/${sh.slug}`;
  const days = Array.from({ length: 14 }, (_, i) => { const start = new Date(); start.setHours(0, 0, 0, 0); const t0 = start.getTime() - (13 - i) * DAY; return { label: fmtShort(t0), views: sh.views.filter((t) => t >= t0 && t < t0 + DAY).length }; });
  const okSlug = SLUG_RE.test(slug);
  return (
    <>
      <MeHead title="Share link" sub="One link that always shows your latest resume — for WhatsApp, emails and your LinkedIn." />
      <section className="card stack g16">
        <label className="row between g12" style={{ cursor: 'pointer' }}>
          <span className="stack"><strong>Link is {sh.on ? 'on' : 'off'}</strong><span className="small muted">{sh.on ? 'Anyone with the link can view and download your resume.' : 'Nobody can open the link right now.'}</span></span>
          <input type="checkbox" role="switch" checked={sh.on} disabled={busy} onChange={(e) => set({ on: e.target.checked, slug: sh.slug || slug }, e.target.checked ? 'Link turned on' : 'Link turned off')} style={{ width: 22, height: 22 }} />
        </label>
        {sh.on && (
          <>
            <div className="well row between g8"><span className="mono small" style={{ overflowWrap: 'anywhere' }}>{url}</span>
              <span className="row g8"><button type="button" className="btn btn-outline" style={{ minHeight: 36 }} onClick={async () => { try { await navigator.clipboard.writeText(`https://${url}`); toast('Link copied'); } catch { toast(`Copy this: https://${url}`); } }}>Copy</button><Link to={`/r/${sh.slug}`} className="btn btn-ghost" style={{ minHeight: 36 }}>Open</Link></span></div>
            <form className="row g8" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); if (okSlug && !busy) set({ slug }, 'Link name changed — the old link stops working'); }}>
              <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="sl" className="label">Link name</label><input id="sl" className="input" style={{ height: 42 }} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} aria-invalid={!okSlug} />{!okSlug && <span className="xs" style={{ color: 'var(--danger)' }}>3–40 letters, numbers or dashes.</span>}</div>
              <button type="submit" className="btn btn-outline" disabled={busy || !okSlug || slug === sh.slug}>{busy ? <Spinner /> : 'Change'}</button>
            </form>
            <div className="row g12">
              <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="sr" className="label">Resume shown</label><select id="sr" className="input" style={{ height: 42 }} value={sh.resumeId || me.resumes.find((r) => r.active)?.id || ''} disabled={busy} onChange={(e) => set({ resumeId: e.target.value })}>{me.resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
              <label className="row g8 small" style={{ flex: '1 1 220px', alignSelf: 'flex-end', minHeight: 42 }}><input type="checkbox" checked={!!sh.hidePhone} disabled={busy} onChange={(e) => set({ hidePhone: e.target.checked })} />Hide my phone number on the link</label>
            </div>
          </>
        )}
      </section>
      <section className="card stack g8">
        <strong className="small">Viewed {sh.views.filter((t) => Date.now() - t < 7 * DAY).length} times this week · {sh.viewCount ?? sh.views.length} in total</strong>
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
            <button type="button" className="btn btn-ink" onClick={async () => { await downloadResume(st.r.data, 'pdf'); toast('PDF ready'); }}>Download PDF</button></div>
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
  const ok = sh.on && sh.slug === slug;
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
              <button type="button" className="btn btn-ink" onClick={async () => { await downloadResume(publicData(r.data, getMe().share), 'pdf'); toast('PDF ready'); }}>Download PDF</button></div>
            <ResumePreview data={publicData(r.data, sh)} design={designOf(r.data)} />
            <span className="xs faint" style={{ textAlign: 'center' }}>Made with Nm7 · <Link to="/">Build yours free</Link></span>
          </>
        )}
      </main>
    </>
  );
}
