import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ensureFonts } from './fontLoader';
import { visibleResume } from './entries';
import ContactLine from './ContactLine';
import { buildSections, isNumWord } from './resumeModel';
import { FONTS, PAGE, headFontOf, marginOf, tint } from './design';
import { coverParts } from './cover';

/** Section heading in the 5 styles. Sizes are pt × s (px per pt). */
function Heading({ title, ds, s }) {
  const color = ds.accentOn.headings ? ds.accent : ds.textColor;
  const line = ds.accentOn.lines ? ds.accent : '#B8B8B8';
  const base = { fontFamily: FONTS[headFontOf(ds)].css, fontSize: ds.headSize * s, fontWeight: ds.headWeight, color, textTransform: 'uppercase', letterSpacing: ds.headingStyle === 'caps' ? '0.16em' : '0.06em', margin: 0, lineHeight: 1.2 };
  if (ds.headingStyle === 'rule') {
    return <h3 style={{ ...base, display: 'flex', alignItems: 'center', gap: 6 * s }}>{title}<span aria-hidden="true" style={{ flex: 1, height: Math.max(1, 0.8 * s), background: line }} /></h3>;
  }
  if (ds.headingStyle === 'bar') return <h3 style={{ ...base, background: tint(ds.accentOn.lines ? ds.accent : '#777777', 0.12), padding: `${2.5 * s}px ${6 * s}px`, borderRadius: 2 * s }}>{title}</h3>;
  if (ds.headingStyle === 'caps') return <h3 style={base}>{title}</h3>;
  if (ds.headingStyle === 'left') return <h3 style={{ ...base, borderLeft: `${3 * s}px solid ${line}`, paddingLeft: 6 * s }}>{title}</h3>;
  return <h3 style={{ ...base, borderBottom: `${Math.max(1, 0.8 * s)}px solid ${line}`, paddingBottom: 2.5 * s }}>{title}</h3>;
}

function Rich({ t, ds }) {
  if (!ds.boldNumbers) return t;
  return t.split(/(\s+)/).map((w, i) => (isNumWord(w) ? <strong key={i} style={{ fontWeight: 700 }}>{w}</strong> : w));
}

function Line({ l, ds, s }) {
  if (typeof l === 'string') return <span style={{ overflowWrap: 'anywhere' }}>{l}</span>;
  if (l.bullet) {
    if (ds.bullet === 'none') return <span style={{ overflowWrap: 'anywhere' }}><Rich t={l.t} ds={ds} /></span>;
    return <span style={{ display: 'grid', gridTemplateColumns: `${9 * s}px minmax(0,1fr)` }}><span aria-hidden="true">{ds.bullet}</span><span style={{ overflowWrap: 'anywhere' }}><Rich t={l.t} ds={ds} /></span></span>;
  }
  if (l.kv) {
    const val = <span style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-line', color: l.url && ds.accentOn.links ? ds.accent : undefined }}>{l.kv[1]}</span>;
    return (
      <span style={{ display: 'grid', gridTemplateColumns: `${ds.bodySize * 9.5 * s}px ${8 * s}px minmax(0,1fr)` }}>
        <span>{l.kv[0]}</span><span aria-hidden="true">:</span>{val}
      </span>
    );
  }
  if (l.sign) {
    return (
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 * s, marginTop: ds.bodySize * 1.2 * s }}>
        <span className="stack">{l.sign.left.map((t) => <span key={t}>{t}</span>)}</span>
        <strong style={{ fontWeight: 700 }}>{l.sign.right}</strong>
      </span>
    );
  }
  if (l.chips) {
    return (
      <span className="stack" style={{ gap: 2 * s }}>
        {l.label && <strong style={{ fontWeight: 700 }}>{l.label}</strong>}
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 3 * s }}>
          {l.chips.map((c) => <span key={c} style={{ border: `${Math.max(1, 0.7 * s)}px solid ${ds.accentOn.lines ? ds.accent : '#AAAAAA'}`, borderRadius: 3 * s, padding: `${0.5 * s}px ${4 * s}px`, fontSize: (ds.bodySize - 0.5) * s }}>{c}</span>)}
        </span>
      </span>
    );
  }
  return <span><strong style={{ fontWeight: 700 }}>{l.bold}</strong> {l.text}</span>;
}

// Thumbnails and home-page samples are pictures: their links are plain text, not clickable or focusable.
const LinksLive = createContext(true);
function Link({ url, children, ...p }) {
  return useContext(LinksLive) ? <a href={url} target="_blank" rel="noreferrer" {...p}>{children}</a> : <span {...p}>{children}</span>;
}

function Item({ it, ds, s }) {
  const dateEl = it.date && <span style={{ color: '#5A5A5A', whiteSpace: ds.datePos === 'right' ? 'nowrap' : 'normal', fontSize: (ds.bodySize - 0.5) * s }}>{it.date}</span>;
  return (
    <div className="stack" style={{ gap: 0.5 * s }}>
      {(it.head || (it.date && ds.datePos === 'right')) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 * s }}>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <strong style={{ fontWeight: 700 }}>{it.head}</strong>
            {it.links?.map((l) => (
              <span key={l.url + l.label}><span style={{ color: '#9A9A9A' }}> | </span>
                <Link url={l.url} style={{ color: ds.accentOn.links ? ds.accent : ds.textColor, textDecoration: 'underline', textDecorationThickness: Math.max(1, 0.6 * s), textUnderlineOffset: 2 * s, fontWeight: 500 }}>{l.label}</Link>
              </span>
            ))}
          </span>
          {ds.datePos === 'right' && dateEl}
        </div>
      )}
      {ds.datePos === 'below' && dateEl}
      {it.sub && <span style={{ color: '#5A5A5A', fontStyle: 'italic' }}>{it.sub}</span>}
      {it.lines?.map((l, i) => <Line key={i} l={l} ds={ds} s={s} />)}
    </div>
  );
}

function Column({ sections, ds, s }) {
  return sections.map((sec) => (
    <section key={sec.id} className="stack" style={{ gap: ds.itemGap * s }}>
      <Heading title={sec.title} ds={ds} s={s} />
      {sec.items.map((it, i) => <Item key={i} it={it} ds={ds} s={s} />)}
    </section>
  ));
}

function CoverBody({ c, ds, s }) {
  const gap = { marginTop: ds.bodySize * 1.1 * s };
  return (
    <div className="stack" style={{ marginTop: 4 * s }}>
      <span>{c.date}</span>
      <span className="stack" style={gap}>{c.to.map((t) => <span key={t}>{t}</span>)}</span>
      {c.subject && <strong style={{ ...gap, fontWeight: 700 }}>{c.subject}</strong>}
      <span style={gap}>{c.greeting}</span>
      {c.body.length ? c.body.map((p, i) => <p key={i} style={{ ...gap, margin: 0, marginTop: ds.bodySize * 0.9 * s }}>{p}</p>)
        : <p style={{ ...gap, margin: 0, color: '#9A9A9A', fontStyle: 'italic' }}>Your letter appears here. Tap “Write a draft for me” to start.</p>}
      <span style={{ marginTop: ds.bodySize * 1.6 * s }}>{c.close}</span>
      <strong style={{ fontWeight: 700, marginTop: ds.bodySize * 0.4 * s }}>{c.name}</strong>
    </div>
  );
}

/**
 * True-to-scale preview: every size is the PDF size in points × (preview width / page width).
 * Reports the page count via onPages and marks where each new page starts.
 */
/**
 * loading: the resume itself is still arriving — no page count or page breaks until it has, and until its fonts
 * have loaded and the layout is measured (otherwise a fallback font can briefly show "2 pages" for a 1-page resume).
 */
/** brand / stamp: organization copies (see lib/branding.js): a header strip with the logo and header line, and the
 * footer line / stamp at the foot. */
export default function ResumePreview({ data, design: ds, photo: photoProp, onPages, cover, loadFonts = true, decorative = false, loading = false, brand = null, stamp = '' }) {
  const d = visibleResume(data); // switched-off entries are hidden everywhere the resume is shown
  const photo = photoProp === undefined ? data?.photo || null : photoProp; // the photo saved with the resume
  const ref = useRef();
  const [box, setBox] = useState({ w: 595, h: 842 });
  const [fontsOk, setFontsOk] = useState(!loadFonts);
  useEffect(() => {
    if (!loadFonts) return undefined;
    let alive = true;
    setFontsOk(false);
    ensureFonts([ds.font, headFontOf(ds)]).then(() => { if (alive) setFontsOk(true); });
    return () => { alive = false; };
  }, [loadFonts, ds.font, ds.headFont]); // eslint-disable-line react-hooks/exhaustive-deps
  const page = PAGE[ds.pageSize] || PAGE.a4;
  const s = box.w / page.w;
  const pageH = page.h * s;
  const m = marginOf(ds) * s;
  const { main, side } = buildSections(d, ds);
  const withPhoto = d.showPhoto && photo;
  const pos = withPhoto ? ds.photoPos || 'left' : null;
  const align = pos === 'top' ? 'center' : withPhoto ? 'left' : ds.headerAlign;
  const psz = (ds.photoSize || 62) * s;
  const pBorderW = { none: 0, thin: 1, thick: 2.5 }[ds.photoBorder || 'none'] * s;
  const photoEl = withPhoto && (
    <img src={photo} alt="" style={{ width: psz, height: psz, flex: 'none', objectFit: 'cover', order: pos === 'right' ? 2 : 0,
      borderRadius: ds.photoShape === 'square' ? 0 : ds.photoShape === 'rounded' ? '14%' : '50%',
      border: pBorderW ? `${pBorderW}px solid ${ds.photoBorderColor === 'grey' ? '#B8B8B8' : ds.accent}` : 'none', boxSizing: 'border-box' }} />
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setBox({ w: el.offsetWidth, h: el.scrollHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pages = Math.max(1, Math.ceil((box.h - 2) / pageH));
  const settled = fontsOk && !loading;
  // measure once more when the fonts are in (the size may not change, so the observer may not fire)
  useLayoutEffect(() => { if (settled && ref.current) setBox({ w: ref.current.offsetWidth, h: ref.current.scrollHeight }); }, [settled]);
  useLayoutEffect(() => { onPages?.(settled ? pages : null); }, [pages, settled, onPages]);

  const body = { fontFamily: FONTS[ds.font].css, fontSize: ds.bodySize * s, lineHeight: ds.lineHeight, fontWeight: ds.bodyWeight, color: ds.textColor };
  const empty = !main.length && !side.length;

  return (
    <LinksLive.Provider value={!decorative}>
    <div style={{ position: 'relative' }}>
      <article ref={ref} aria-label={cover ? 'Cover letter preview' : 'Resume preview'}
        style={{ ...body, background: '#fff', borderRadius: 4, boxShadow: 'var(--shadow)', padding: m, minHeight: pageH, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: ds.sectionGap * s }}>
        {brand && !cover && (
          <div data-testid="brand-strip" style={{ display: 'flex', alignItems: 'center', gap: 10 * s, margin: `${-m * 0.4}px 0 0`, paddingBottom: 6 * s, borderBottom: `${1.2 * s}px solid ${brand.color}` }}>
            {brand.logo && <img src={brand.logo} alt="" style={{ height: 26 * s, maxWidth: 170 * s, objectFit: 'contain' }} />}
            {brand.header && <span style={{ color: brand.color, fontWeight: 700, fontSize: 10 * s, lineHeight: 1.2 }}>{brand.header}</span>}
          </div>
        )}
        <header style={{
          display: 'flex', flexDirection: pos === 'top' ? 'column' : 'row', alignItems: 'center', gap: (pos === 'top' ? 8 : 14) * s, paddingBottom: 8 * s,
          ...(ds.headerStyle === 'band' ? { background: tint(ds.accent, 0.1), margin: `${-m}px ${-m}px 0`, padding: `${m * 0.75}px ${m}px ${12 * s}px`, borderRadius: '4px 4px 0 0' }
            : ds.headerStyle === 'none' ? {} : { borderBottom: ds.accentOn.lines ? `${1.5 * s}px solid ${ds.accent}` : `${1 * s}px solid #CFCFCF` }),
        }}>
          {photoEl}
          <div className="stack" style={{ flex: 1, minWidth: 0, width: pos === 'top' ? '100%' : undefined, gap: 3 * s, textAlign: align }}>
            <span style={{ fontFamily: FONTS[headFontOf(ds)].css, fontSize: ds.nameSize * s, fontWeight: 700, lineHeight: 1.1, color: ds.accentOn.name ? ds.accent : ds.textColor }}>{d.personal.name || 'Your Name'}</span>
            {d.personal.headline && <span style={{ fontSize: (ds.bodySize + 1.5) * s, color: ds.accentOn.name ? ds.accent : '#444', fontWeight: 500 }}>{d.personal.headline}</span>}
            <ContactLine d={d} ds={ds} s={s} align={align} />
          </div>
        </header>
        {cover ? <CoverBody c={coverParts(d, cover)} ds={ds} s={s} /> : <>
        {empty && <span style={{ color: '#9A9A9A', fontStyle: 'italic' }}>Your sections appear here as you fill them in.</span>}
        {ds.layout === 'two' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '32% minmax(0, 1fr)', gap: 18 * s }}>
            <div className="stack" style={{ gap: ds.sectionGap * s, ...(ds.sideTint ? { background: tint(ds.accent, 0.07), padding: 8 * s, margin: -8 * s, borderRadius: 4 * s, alignSelf: 'stretch' } : {}) }}><Column sections={side} ds={ds} s={s} /></div>
            <div className="stack" style={{ gap: ds.sectionGap * s }}><Column sections={main} ds={ds} s={s} /></div>
          </div>
        ) : <Column sections={main} ds={ds} s={s} />}
        </>}
        {((brand?.footer && !cover) || stamp) && (
          <div data-testid="page-foot" style={{ marginTop: 'auto', textAlign: 'center', fontSize: 7.5 * s, color: '#6E6E6E', lineHeight: 1.4 }}>
            {brand?.footer && !cover && <div>{brand.footer}</div>}
            {stamp && <div>{stamp}</div>}
          </div>
        )}
      </article>
      {/* page-break markers are decorative: the label is CSS content (data-label), so it is never in the page text */}
      {!decorative && settled && Array.from({ length: pages - 1 }, (_, i) => (
        <div key={i} aria-hidden="true" className="page-break" data-label={`Page ${i + 2} starts`} style={{ top: pageH * (i + 1) }} />
      ))}
    </div>
    </LinksLive.Provider>
  );
}
