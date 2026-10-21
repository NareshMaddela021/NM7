// /templates: every template, shown with the example person ("Sample resume") or with the signed-in person's own
// resume ("My details", the same saved resume the builder edits). A card tap opens the large preview; "Use this
// template" applies it and opens the builder; Download (own resume only) is the one thing here that makes a file.
// Own details are drawn in this browser only, for the signed-in owner: nothing personal is in the page's HTML,
// its share image or any public cache. Thumbnails are drawn only as they come on screen; no PDF code loads until
// Download is tapped. An edit saved in the builder in another tab shows here within about a second.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import SiteFooter from '../components/SiteFooter';
import { useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { activeResume, blankResume, openInBuilder, useMe } from '../lib/customerStore';
import { DownloadBlocked, exportFile } from '../lib/downloads';
import { onResumeSaved } from '../lib/resumeChannel';
import ResumePreview from './builder/ResumePreview';
import TemplatePreview from './builder/TemplatePreview';
import { TEMPLATE_PRESETS } from './builder/design';
import { INITIAL, migrateLinks } from './builder/schema';
import { audienceOf, hasOwnDetails, layoutOf, PHOTO_PLACEHOLDER, readView, saveView, startView, withTemplate } from './builder/templatePick';
import { InView, NoDetails, ViewSwitch } from './builder/ViewSwitch';

const FILTERS = [['all', 'All'], ['fresher', 'Freshers'], ['tech', 'Tech'], ['govt', 'Govt & PSU'], ['care', 'Healthcare'], ['photo', 'With photo']];
const KEYS = Object.keys(TEMPLATE_PRESETS);
const matches = (t, f) => f === 'all' || (f === 'fresher' ? t.level === 'fresher' : f === 'photo' ? !!t.photo : t.ind.includes(f));

export default function Templates() {
  const nav = useNavigate();
  const toast = useToast();
  const auth = useAuth();
  const customer = auth.user?.role === 'customer';
  const me = useMe();
  const resumes = customer && !me.loading ? me.resumes : [];
  const [pickedId, setPickedId] = useState(null);
  const resume = resumes.find((r) => r.id === pickedId) || (resumes.length ? activeResume(me) : null);
  // saves from the builder in another tab (same account): newest data per resume
  const [latest, setLatest] = useState({});
  useEffect(() => onResumeSaved(({ id, data }) => setLatest((p) => ({ ...p, [id]: data }))), []);
  const raw = resume ? latest[resume.id] || resume.data : null;
  const mineData = useMemo(() => (raw ? migrateLinks({ ...blankResume(), ...raw }) : null), [raw]); // every section present, as in the builder
  const own = hasOwnDetails(mineData) ? mineData : null;
  const loadingMine = !auth.ready || (customer && me.loading);

  const [saved, setSaved] = useState(readView);
  const view = startView(saved, own);
  const setView = (v) => { setSaved(v); saveView(v); };
  const mine = view === 'mine';
  const [filter, setFilter] = useState('all');
  const keys = useMemo(() => KEYS.filter((k) => matches(TEMPLATE_PRESETS[k], filter)), [filter]);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);

  const shownFor = (k) => (mine ? (own ? withTemplate(own, k) : null) : { data: { ...INITIAL, ...layoutOf(k) }, design: withTemplate(INITIAL, k).design });
  const start = () => nav('/builder', customer ? { state: { open: 'build' } } : undefined);
  const use = (k) => {
    if (customer && resume && !resume.active) openInBuilder(resume.id); // the resume shown here is the one to edit
    nav('/builder', { state: { open: 'build', template: k } });
  };
  const download = async (shown) => {
    setBusy(true);
    try {
      await exportFile({ data: shown.data, design: shown.design, format: 'pdf', photo: shown.data.photo || null }); // asks the server first
      toast('Resume PDF ready');
    } catch (e) {
      if (!(e instanceof DownloadBlocked) && e?.code !== 'declined') toast('Couldn’t create the PDF. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <>
      <Header />
      <main id="main" className="container stack g20" style={{ padding: '40px 16px 72px', maxWidth: 1320 }}>
        <div className="stack g8">
          <h1 className="display" style={{ fontSize: 'clamp(30px, 5vw, 44px)' }}>Resume templates</h1>
          <span className="muted">{KEYS.length} ATS-safe templates. Tap one to see it large — with the sample person or with your own details.</span>
        </div>
        <div className="row between g12" style={{ alignItems: 'center' }}>
          <div className="row g12" style={{ alignItems: 'center' }}>
            <ViewSwitch view={view} onChange={setView} />
            {mine && resumes.length > 1 && (
              <label className="row g8 small" style={{ alignItems: 'center' }}>
                <span>Showing:</span>
                <select className="input" style={{ minHeight: 44, width: 'auto' }} value={resume?.id || ''} onChange={(e) => setPickedId(e.target.value)}>
                  {resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="row g8" role="group" aria-label="Filter templates">
            {FILTERS.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)} style={{ minHeight: 44 }}>{l}</button>)}
          </div>
        </div>
        {mine && !own && !loadingMine && <NoDetails onStart={start} />}
        {mine && !own && loadingMine && <span className="small muted" aria-live="polite">Loading your resume…</span>}

        <div className="tg-grid" data-testid="template-grid" data-view={view}>
          {keys.map((k) => {
            const t = TEMPLATE_PRESETS[k];
            const shown = shownFor(k);
            return (
              <button key={k} type="button" className="tg-card" aria-haspopup="dialog" aria-label={`Preview the ${t.name} template`} data-testid={`tg-card-${k}`} onClick={() => setOpen(k)}>
                <span aria-hidden="true" className="tg-thumb">
                  {shown ? (
                    <InView height="var(--tg-h)">
                      <ResumePreview decorative data={shown.data} design={shown.design} photo={t.photo ? (shown.data.photo || PHOTO_PLACEHOLDER) : shown.data.photo || null} />
                    </InView>
                  ) : <span className="tp-thumb-wait" style={{ display: 'block', height: 'var(--tg-h)' }} />}
                </span>
                <span className="row between g8" style={{ alignItems: 'center' }}>
                  <strong>{t.name}</strong>
                  {!mine && <span className="badge b-neutral">Sample</span>}
                </span>
                <span className="xs muted">{t.design.layout === 'two' ? '2 columns' : '1 column'} · {audienceOf(t)}</span>
              </button>
            );
          })}
        </div>
      </main>
      <SiteFooter />
      {open && (
        <TemplatePreview id={open} view={view} onView={setView} data={own} busy={busy}
          onStart={() => { setOpen(null); start(); }} onClose={() => setOpen(null)} onUse={() => use(open)}
          onDownload={customer && own ? download : undefined} />
      )}
    </>
  );
}
