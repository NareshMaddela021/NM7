// Template screen: filters (level, industry, columns, photo, ATS-safe), a colour row on every card,
// an ATS badge and a "Suggested for you" badge. Continuing never needs a scroll back up: the selected card has its
// own "Use <Template>" button, and from the first pick a bar stays at the bottom of the screen. Double-click a card,
// or press Enter / Space on it, to use it straight away. Every "Use" button does what the top one does (onNext).
import { useEffect, useMemo, useReducer, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/ui';
import ResumePreview from './ResumePreview';
import { ACCENTS, DEFAULT_DESIGN, INDUSTRY_TAGS, TEMPLATE_PRESETS, atsCheck } from './design';
import { SECTION_LAYOUTS } from './schema';
import { isUseKey, pickState, selectionText } from './templatePick';

export const layoutOf = (k) => SECTION_LAYOUTS[TEMPLATE_PRESETS[k]?.sections || 'standard'];
// grey silhouette so photo templates show where the photo goes
export const PHOTO_PLACEHOLDER = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#D9DCE1"/><circle cx="32" cy="25" r="11" fill="#A9AFB8"/><path d="M10 60c2-12 11-18 22-18s20 6 22 18z" fill="#A9AFB8"/></svg>')}`;

const swatchesFor = (t) => [t.design.accent, ...ACCENTS.filter((c) => c.toLowerCase() !== t.design.accent.toLowerCase())].slice(0, 6);

function Chip({ on, onClick, children }) {
  return <button type="button" className="chip" aria-pressed={on} onClick={onClick} style={{ minHeight: 36, fontSize: 13 }}>{children}</button>;
}

export default function TemplatePicker({ d, ds, suggest, photo, onPick, onNext }) {
  const [level, setLevel] = useState('all');
  const [ind, setInd] = useState(null);
  const [cols, setCols] = useState(null);
  const [photoOnly, setPhotoOnly] = useState(false);
  const [atsOnly, setAtsOnly] = useState(false);
  const [accents, setAccents] = useState({});

  const all = useMemo(() => Object.entries(TEMPLATE_PRESETS).map(([k, t]) => {
    const accent = accents[k] || (ds.preset === k ? ds.accent : t.design.accent);
    const design = { ...DEFAULT_DESIGN, ...t.design, accent };
    return { k, t, design, accent, ats: atsCheck(design, { ...d, showPhoto: !!t.photo }).score, two: t.design.layout === 'two' };
  }), [accents, d, ds.preset, ds.accent]);

  const list = all
    .filter(({ t }) => level === 'all' || t.level === 'all' || t.level === level)
    .filter(({ t }) => !ind || t.ind.includes(ind))
    .filter(({ two }) => !cols || (cols === 2 ? two : !two))
    .filter(({ t }) => !photoOnly || t.photo)
    .filter(({ ats }) => !atsOnly || ats >= 90)
    .sort((a, b) => (b.k === suggest) - (a.k === suggest));
  const filtered = level !== 'all' || ind || cols || photoOnly || atsOnly;
  const clear = () => { setLevel('all'); setInd(null); setCols(null); setPhotoOnly(false); setAtsOnly(false); };
  const cur = TEMPLATE_PRESETS[ds.preset];
  const [pick, dispatch] = useReducer(pickState, { selected: ds.preset, touched: false });
  useEffect(() => { dispatch({ type: 'sync', key: ds.preset }); }, [ds.preset]);
  const sel = all.find((x) => x.k === pick.selected) || all.find((x) => x.k === ds.preset);
  const text = selectionText(sel?.t || cur, { ats: sel?.ats, two: sel?.two });
  const choose = (k, accent) => { dispatch({ type: 'pick', key: k }); onPick(k, { accent }); };
  const useNow = (k, accent) => { if (ds.preset !== k) onPick(k, { accent }); onNext(); }; // same as the top button
  const bar = pick.touched && sel;

  return (
    <main className="container stack g20 rise" style={{ padding: '48px 24px 72px', paddingBottom: bar ? 'calc(var(--tp-bar-h) + 40px + env(safe-area-inset-bottom, 0px))' : 72, maxWidth: 1320 }}>
      <span className="sr-only" aria-live="polite" data-testid="tp-announce">{pick.touched ? text.announce : ''}</span>
      <div className="row between g16" style={{ alignItems: 'flex-end' }}>
        <div className="stack g8"><h1 className="display" style={{ fontSize: 40 }}>Pick a starting look</h1><span className="muted">{Object.keys(TEMPLATE_PRESETS).length} templates. Every font, colour and spacing can be changed later in the Design tab.</span></div>
        <button type="button" className="btn btn-ink btn-lg" data-testid="tp-use-top" onClick={onNext}>{text.use} <Icon name="arrow" /></button>
      </div>

      {/* filters */}
      <section aria-label="Filter templates" className="card stack g12" style={{ padding: 16 }}>
        <div className="row g8" style={{ alignItems: 'center' }}>
          <span className="xs strong muted" style={{ width: 84 }}>I am</span>
          {[['all', 'Anyone'], ['fresher', 'Fresher / student'], ['experienced', 'Experienced']].map(([v, l]) => <Chip key={v} on={level === v} onClick={() => setLevel(v)}>{l}</Chip>)}
        </div>
        <div className="row g8" style={{ alignItems: 'center' }}>
          <span className="xs strong muted" style={{ width: 84 }}>Industry</span>
          <Chip on={!ind} onClick={() => setInd(null)}>All</Chip>
          {INDUSTRY_TAGS.map(([v, l]) => <Chip key={v} on={ind === v} onClick={() => setInd(ind === v ? null : v)}>{l}</Chip>)}
        </div>
        <div className="row g8" style={{ alignItems: 'center' }}>
          <span className="xs strong muted" style={{ width: 84 }}>Layout</span>
          <Chip on={cols === 1} onClick={() => setCols(cols === 1 ? null : 1)}>1 column</Chip>
          <Chip on={cols === 2} onClick={() => setCols(cols === 2 ? null : 2)}>2 columns</Chip>
          <Chip on={photoOnly} onClick={() => setPhotoOnly(!photoOnly)}>With photo</Chip>
          <Chip on={atsOnly} onClick={() => setAtsOnly(!atsOnly)}>ATS-safe only (90+)</Chip>
          {filtered && <button type="button" className="btn btn-ghost" style={{ minHeight: 36, fontSize: 13 }} onClick={clear}>Clear filters</button>}
        </div>
      </section>
      <span className="xs muted" aria-live="polite">Showing {list.length} of {all.length}</span>

      {list.length === 0 && (
        <div className="card stack g8" style={{ alignItems: 'flex-start' }}><strong>No template matches all of these filters.</strong><button type="button" className="btn btn-outline" onClick={clear}>Clear filters</button></div>
      )}

      <div role="radiogroup" aria-label="Templates" className="grid-auto g20" style={{ '--min': '240px' }}>
        {list.map(({ k, t, design, accent, ats, two }) => {
          const chosen = ds.preset === k;
          return (
            <div key={k} className="card stack g8 tp-card" data-testid={`tp-card-${k}`} data-selected={chosen || undefined}
              style={{ padding: 11, border: `2px solid ${chosen ? 'var(--ink)' : 'var(--border)'}` }}>
              <button type="button" role="radio" aria-checked={chosen} aria-label={`${t.name} template`}
                onClick={() => choose(k, accent)} onDoubleClick={() => useNow(k, accent)}
                onKeyDown={(e) => { if (isUseKey(e)) { e.preventDefault(); useNow(k, accent); } }}
                style={{ padding: 0, border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', position: 'relative' }}>
                <div aria-hidden="true" style={{ height: 300, overflow: 'hidden', borderRadius: 6, pointerEvents: 'none' }}>
                  <ResumePreview decorative data={{ ...d, ...layoutOf(k) }} design={design} photo={t.photo ? (photo || PHOTO_PLACEHOLDER) : photo} />
                </div>
                <span aria-hidden="true" className="tp-check" style={{ visibility: chosen ? 'visible' : 'hidden' }}>✓</span>
              </button>
              <div className="row g8" style={{ alignItems: 'center' }}>
                <strong>{t.name}</strong>
                {suggest === k && <span className="badge b-signal">Suggested for you</span>}
              </div>
              <div className="row g4">
                <span className={`badge ${ats >= 90 ? 'b-success' : ats >= 75 ? 'b-warning' : 'b-danger'}`} title="How safely tracking systems can read it">ATS {ats}</span>
                <span className="badge b-neutral">{two ? '2 columns' : '1 column'}</span>
                {t.photo && <span className="badge b-neutral">Photo</span>}
                <span className="badge b-neutral">{t.level === 'fresher' ? 'Freshers' : t.level === 'experienced' ? 'Experienced' : 'Any level'}</span>
              </div>
              <span className="xs muted" style={{ minHeight: 34 }}>{t.desc}</span>
              <div className="row g4" role="group" aria-label={`${t.name} colours`}>
                {swatchesFor(t).map((c) => (
                  <button key={c} type="button" aria-label={`${t.name} in colour ${c}`} aria-pressed={accent === c}
                    onClick={() => { setAccents((p) => ({ ...p, [k]: c })); onPick(k, { accent: c }); }}
                    style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: accent === c ? '3px solid var(--surface)' : '2px solid transparent', boxShadow: accent === c ? '0 0 0 2px var(--ink)' : 'none', cursor: 'pointer', padding: 0 }} />
                ))}
              </div>
              {/* the space is kept on every card, so selecting one never moves anything */}
              <button type="button" className="btn btn-ink tp-use" data-testid="tp-use-card" onClick={() => useNow(k, accent)}
                style={{ visibility: chosen ? 'visible' : 'hidden' }}>Use {t.name} <Icon name="arrow" /></button>
            </div>
          );
        })}
      </div>

      {/* on <body>: a transformed ancestor (an entry animation) would pin a fixed bar to itself, not the screen */}
      {bar && createPortal(
        <div className="tp-bar" role="region" aria-label="Selected template" data-testid="tp-bar">
          <div className="tp-bar-in">
            <span className="tp-bar-thumb" aria-hidden="true"><ResumePreview decorative loadFonts={false} data={{ ...d, ...layoutOf(sel.k) }} design={sel.design} /></span>
            <span className="stack" style={{ minWidth: 0, flex: '1 1 auto' }}>
              <strong className="tp-bar-name">{text.name}</strong>
              <span className="xs muted" data-testid="tp-bar-meta">{text.meta}</span>
            </span>
            <button type="button" className="btn btn-ink btn-lg tp-bar-use" data-testid="tp-use-bar" onClick={() => useNow(sel.k, sel.accent)}>{text.use} <Icon name="arrow" /></button>
          </div>
        </div>,
        document.body,
      )}
    </main>
  );
}
