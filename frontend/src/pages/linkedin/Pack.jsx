// The LinkedIn pack (Rs 149) on /linkedin, under both paths.
//   not owned: what is in it, and "Buy ₹149" only when payments are on (else "Coming soon": nothing can be bought)
//   owned:     "Make my LinkedIn pack" from what the person entered above, then the pack itself (saved on the
//              account): copy per item, where to paste (EN / TE / HI), before → after and "Keep as it is" in Path 1,
//              one regenerate per written section, the person's own edits (never replaced without asking), the
//              banner PNG.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, Icon, Spinner, useToast } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { LANGS, REVIEW_NOTE, pasteWhere } from '../../lib/linkedin/guide';
import { BANNER_H, BANNER_W, COMING_SOON, LIMITS, PACK_ITEMS, REGEN_SECTIONS, SECTION_TITLE, buyPack, downloadBanner, drawBanner, editSection, generatePack, getPack, packStatus, regenerateSection } from '../../lib/linkedin/pack';
import { BUY_WA, WA_PAY_TEXT } from '../../lib/waPay';
import { CopyButton } from './parts';
import CodeBox from '../../components/CodeBox';
import { inrExact } from '../../lib/pricing';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

export default function Pack({ request, accent = '#111827', onOwned }) {
  const auth = useAuth();
  const toast = useToast();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [quote, setQuote] = useState(null); // a discount code applied
  const reload = () => packStatus().then((s) => { setSt(s); if (s.owned) onOwned?.(); });
  useEffect(() => { reload(); }, [auth.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (st && window.location.hash === '#pack') document.getElementById('pack')?.scrollIntoView({ block: 'start' });
  }, [st]);
  if (!st) return null;
  if (st.owned) return <div id="pack"><PackOwned request={request} accent={accent} /></div>;

  const signedIn = auth.user?.role === 'customer';
  const price = quote ? quote.final / 100 : st.price;
  const buy = async () => {
    setBusy(true); setErr('');
    try {
      const r = await buyPack(st.mode, quote?.code);
      if (!r?.whatsapp) { toast('LinkedIn pack unlocked'); await reload(); }
    } catch (e) {
      setErr(e.code === 'dismissed' ? e.message : e.message || 'Payment didn’t go through. You haven’t been charged.');
    } finally { setBusy(false); }
  };
  return (
    <section id="pack" className="card stack g12" aria-labelledby="li-pack-h" data-testid="li-locked">
      <div className="row between g8" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h2 id="li-pack-h" className="h3" style={{ margin: 0 }}>LinkedIn pack</h2>
        <strong data-testid="li-pack-price">{inr(st.price)}</strong>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Your whole profile written from your own details, ready to paste. Saved on your account.</p>
      <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {PACK_ITEMS.map((t) => (
          <li key={t} className="row g8 small" style={{ alignItems: 'center' }}><Icon name="lock" size={14} />{t}</li>
        ))}
      </ul>
      {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
      {st.onSale && signedIn ? (
        <button type="button" className="btn btn-ink btn-lg" data-testid="li-pack-buy" onClick={buy} disabled={busy} aria-busy={busy} style={{ alignSelf: 'flex-start' }}>
          {busy && <Spinner />}{st.mode === 'whatsapp' ? (busy ? 'Opening WhatsApp…' : BUY_WA) : busy ? 'Waiting for your payment…' : `Buy ${inrExact(price)}`}
        </button>
      ) : st.onSale ? (
        <Link to="/login?next=%2Flinkedin" className="btn btn-ink" style={{ alignSelf: 'flex-start' }}>Sign in to buy</Link>
      ) : (
        <button type="button" className="btn btn-outline" aria-disabled="true" data-testid="li-pack-soon" style={{ minHeight: 44, opacity: 0.7, cursor: 'not-allowed', alignSelf: 'flex-start' }} onClick={(e) => e.preventDefault()}>{COMING_SOON}</button>
      )}
      {signedIn && <CodeBox item="linkedin_pack" onApplied={setQuote} disabled={busy} onUnlocked={async () => { toast('LinkedIn pack unlocked'); await reload(); }} />}
      {st.onSale && <span className="xs faint">{st.mode === 'whatsapp' ? `${WA_PAY_TEXT} Included in Career Launch.` : 'UPI, card or netbanking · GST invoice emailed · Included in Career Launch'}</span>}
    </section>
  );
}

function PackOwned({ request, accent }) {
  const [d, setD] = useState(undefined); // undefined: loading; { pack: null } before it is made
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [lang, setLang] = useState('en');
  useEffect(() => { getPack().then(setD).catch(() => setD({ pack: null })); }, []);
  if (d === undefined) return <section className="card" aria-busy="true"><Spinner /></section>;

  const make = async () => {
    const body = request?.();
    if (!body) { setErr('Fill in your profile above first: the job you want, your skills or your degree.'); return; }
    setBusy(true); setErr('');
    try { setD(await generatePack(body)); } catch (e) { setErr(e.message || 'Couldn’t make your pack. Please try again.'); } finally { setBusy(false); }
  };
  if (!d.pack) {
    return (
      <section className="card stack g12" aria-labelledby="li-pack-h" data-testid="li-pack-make">
        <h2 id="li-pack-h" className="h3" style={{ margin: 0 }}>Your LinkedIn pack is unlocked</h2>
        <p className="small muted" style={{ margin: 0 }}>We write it from what you entered above. Only your own facts are used.</p>
        {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
        <button type="button" className="btn btn-ink btn-lg" data-testid="li-pack-generate" onClick={make} disabled={busy} style={{ alignSelf: 'flex-start' }}>
          {busy && <Spinner />}{busy ? 'Writing your pack… (about 20 seconds)' : 'Make my LinkedIn pack'}
        </button>
      </section>
    );
  }
  return <PackView d={d} setD={setD} lang={lang} setLang={setLang} accent={accent} />;
}

function Where({ section, lang }) {
  const w = pasteWhere(section, lang);
  return <span className="xs muted" lang={lang} data-testid={`li-where-${section}`}>Where to paste: {w.text}{w.review ? ` (${REVIEW_NOTE})` : ''}</span>;
}

/** Section header: title, "Regenerate (1 free)" for the written sections, and Edit. */
function Head({ section, d, onRegen, onEdit, editing }) {
  const used = !!d.regenerated?.[section];
  return (
    <div className="row between g8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <h3 className="h4" style={{ margin: 0 }}>{SECTION_TITLE[section]}{d.edited?.[section] ? <span className="xs muted" style={{ fontWeight: 400 }}> · edited by you</span> : null}</h3>
      <span className="row g8">
        {REGEN_SECTIONS.includes(section) && (
          <button type="button" className="btn btn-outline" data-testid={`li-regen-${section}`} disabled={used} onClick={onRegen} style={{ minHeight: 40 }}>
            {used ? 'Regenerated' : 'Regenerate (1 free)'}
          </button>
        )}
        {onEdit && <button type="button" className="btn btn-ghost" data-testid={`li-edit-${section}`} onClick={onEdit} style={{ minHeight: 40 }}>{editing ? 'Cancel' : 'Edit'}</button>}
      </span>
    </div>
  );
}

function Keep({ show }) {
  return show ? <span className="row g8 small" data-testid="li-keep" style={{ alignItems: 'center', color: 'var(--success)' }}><Icon name="check" size={16} />Keep as it is</span> : null;
}

function PackView({ d, setD, lang, setLang, accent }) {
  const toast = useToast();
  const p = d.pack;
  const fix = d.path === 'fix';
  const [editing, setEditing] = useState('');
  const [draft, setDraft] = useState(null);
  const [ask, setAsk] = useState(null); // section waiting for "replace your edits?"
  const [busy, setBusy] = useState('');
  const [aboutTab, setAboutTab] = useState('simple');

  const regen = async (section, confirm = false) => {
    setBusy(section);
    try {
      const r = await regenerateSection(section, confirm);
      setD(r); setAsk(null);
      toast(`${SECTION_TITLE[section]}: new version ready`);
    } catch (e) {
      if (e.code === 'edited') setAsk(section);
      else toast(e.message || 'Couldn’t regenerate. Please try again.');
    } finally { setBusy(''); }
  };
  const startEdit = (section, value) => { if (editing === section) { setEditing(''); return; } setEditing(section); setDraft(value); };
  const save = async (section, value) => {
    setBusy(section);
    try { setD(await editSection(section, value)); setEditing(''); toast('Saved. Your changes are kept.'); } catch (e) { toast(e.message || 'Not saved.'); } finally { setBusy(''); }
  };

  return (
    <section className="stack g16" aria-labelledby="li-pack-h" data-testid="li-pack">
      <div className="card stack g8">
        <div className="row between g8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 id="li-pack-h" className="h3" style={{ margin: 0 }}>Your LinkedIn pack</h2>
          <div className="segmented" role="group" aria-label="Where-to-paste language">
            {LANGS.map((l) => <button key={l.id} type="button" aria-pressed={lang === l.id} lang={l.id} onClick={() => setLang(l.id)}>{l.label}</button>)}
          </div>
        </div>
        <span className="xs muted">Saved on your account. Open it any time. Each written section can be regenerated once; your edits are kept.</span>
        {d.notice && <span className="xs muted" data-testid="li-pack-notice">{d.notice}</span>}
      </div>

      {/* 1. headline */}
      <article className="card stack g8" data-testid="li-pack-headline">
        <Head section="headline" d={d} onRegen={() => regen('headline')} editing={editing === 'headline'} onEdit={() => startEdit('headline', p.headline.options.join('\n'))} />
        {fix && p.headline.before && <span className="small"><span className="muted">Before: </span>{p.headline.before}</span>}
        <Keep show={p.headline.keep} />
        {editing === 'headline' ? (
          <Editor value={draft} onChange={setDraft} rows={6} hint="One headline per line, at most 220 characters each." busy={busy === 'headline'}
            onSave={() => save('headline', { ...p.headline, options: draft.split('\n').map((x) => x.trim()).filter(Boolean) })} />
        ) : (
          <ol className="stack g8" style={{ margin: 0, paddingLeft: 20 }}>
            {p.headline.options.map((h) => (
              <li key={h} className="stack g4"><span data-testid="li-pack-option">{h}</span><span className="row g8" style={{ alignItems: 'center' }}><span className="xs faint">{h.length}/{LIMITS.headline}</span><CopyButton text={h} /></span></li>
            ))}
          </ol>
        )}
        <Where section="headline" lang={lang} />
      </article>

      {/* 2. about */}
      <article className="card stack g8" data-testid="li-pack-about">
        <Head section="about" d={d} onRegen={() => regen('about')} editing={editing === 'about'} onEdit={() => startEdit('about', { simple: p.about.simple, professional: p.about.professional, story: p.about.story })} />
        {fix && p.about.before && <details><summary className="small muted">Before</summary><p className="small" style={{ whiteSpace: 'pre-wrap' }}>{p.about.before}</p></details>}
        <Keep show={p.about.keep} />
        <div className="segmented" role="group" aria-label="About style">
          {[['simple', 'Simple'], ['professional', 'Professional'], ['story', 'Story']].map(([k, l]) => <button key={k} type="button" aria-pressed={aboutTab === k} onClick={() => setAboutTab(k)}>{l}</button>)}
        </div>
        {editing === 'about' ? (
          <Editor value={draft[aboutTab]} onChange={(v) => setDraft({ ...draft, [aboutTab]: v })} rows={10} max={LIMITS.about} busy={busy === 'about'} onSave={() => save('about', { ...p.about, ...draft })} />
        ) : (
          <>
            <p className="small" data-testid="li-pack-about-text" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{p.about[aboutTab]}</p>
            <span className="row g8" style={{ alignItems: 'center' }}><span className="xs faint">{p.about[aboutTab].length.toLocaleString('en-IN')}/{LIMITS.about.toLocaleString('en-IN')}</span><CopyButton text={p.about[aboutTab]} testid="li-copy-about" /></span>
          </>
        )}
        <Where section="about" lang={lang} />
      </article>

      {/* 3. experience */}
      <article className="card stack g12" data-testid="li-pack-experience">
        <Head section="experience" d={d} onRegen={() => regen('experience')} editing={editing === 'experience'} onEdit={() => startEdit('experience', p.experience.map((e) => e.text))} />
        {p.experience.length === 0 && <span className="small muted">Add a job, internship or project above to get this section.</span>}
        {p.experience.map((e, i) => (
          <div key={`${e.title}-${i}`} className="well stack g8" data-testid="li-pack-exp">
            <strong className="small">{[e.title, e.company].filter(Boolean).join(' · ')}{e.kind === 'project' ? <span className="xs muted" style={{ fontWeight: 400 }}> · project as experience</span> : null}</strong>
            {fix && e.before && !e.keep && <span className="xs"><span className="muted">Before: </span>{e.before}</span>}
            <Keep show={e.keep} />
            {editing === 'experience' ? (
              <textarea className="input" rows={5} value={draft[i]} maxLength={LIMITS.experience + 200} onChange={(ev) => setDraft(draft.map((x, j) => (j === i ? ev.target.value : x)))} aria-label={`${e.title} description`} />
            ) : (
              <>
                <span className="small" style={{ whiteSpace: 'pre-wrap' }}>{e.text}</span>
                <span className="row g8" style={{ alignItems: 'center' }}><span className="xs faint">{e.text.length}/{LIMITS.experience.toLocaleString('en-IN')}</span><CopyButton text={e.text} /></span>
              </>
            )}
          </div>
        ))}
        {editing === 'experience' && <button type="button" className="btn btn-ink" disabled={busy === 'experience'} onClick={() => save('experience', p.experience.map((e, i) => ({ ...e, text: draft[i] })))} style={{ alignSelf: 'flex-start' }}>Save</button>}
        <Where section="experience" lang={lang} />
      </article>

      {/* 4. education */}
      <article className="card stack g8" data-testid="li-pack-education">
        <Head section="education" d={d} onRegen={() => regen('education')} />
        {p.education.map((e) => <span key={e.text} className="row between g8 small" style={{ alignItems: 'center', flexWrap: 'wrap' }}><span>{e.text}</span><CopyButton text={e.text} /></span>)}
        <Where section="education" lang={lang} />
      </article>

      {/* 5. skills */}
      <article className="card stack g8" data-testid="li-pack-skills">
        <Head section="skills" d={d} editing={editing === 'skills'} onEdit={() => startEdit('skills', p.skills.ranked.join(', '))} />
        {editing === 'skills' ? (
          <Editor value={draft} onChange={setDraft} rows={4} hint="Separate with commas. Best ones first." busy={busy === 'skills'} onSave={() => save('skills', { ...p.skills, ranked: draft.split(',').map((x) => x.trim()).filter(Boolean) })} />
        ) : (
          <>
            <ol className="row g8" style={{ flexWrap: 'wrap', listStyle: 'none', margin: 0, padding: 0 }} aria-label="Skills, best first">
              {p.skills.ranked.map((s, i) => <li key={s} className="chip" data-testid="li-pack-skill" style={i < 5 ? { borderColor: 'var(--ink)', fontWeight: 700 } : undefined}>{s}</li>)}
            </ol>
            <span className="xs muted">The first 5 (bold) are your best for the role: pin them.</span>
            <CopyButton text={p.skills.ranked.join(', ')} label="Copy all skills" />
          </>
        )}
        {p.skills.missing?.length > 0 && <span className="xs">Recruiters for this role also search for: <strong>{p.skills.missing.join(', ')}</strong>. Add them only if you really have them.</span>}
        <Where section="skills" lang={lang} />
      </article>

      {/* 6. featured */}
      <article className="card stack g8" data-testid="li-pack-featured">
        <Head section="featured" d={d} />
        <ol className="stack g8" style={{ margin: 0, paddingLeft: 20 }}>
          {p.featured.map((f) => <li key={`${f.kind}-${f.title}`} className="small"><strong>{f.title}</strong>{f.link ? <> · <span className="mono">{f.link}</span></> : null}<br /><span className="xs muted">{f.why}</span></li>)}
        </ol>
        <Where section="featured" lang={lang} />
      </article>

      {/* 7. banner */}
      <Banner banner={p.banner} accent={accent} lang={lang} />

      {/* 8. URLs */}
      <article className="card stack g8" data-testid="li-pack-urls">
        <Head section="urls" d={d} />
        {p.urls.map((u) => <span key={u} className="row between g8" style={{ alignItems: 'center', flexWrap: 'wrap' }}><span className="mono small" data-testid="li-pack-url">{u}</span><CopyButton text={u.replace('linkedin.com/in/', '')} label="Copy" /></span>)}
        <Where section="urls" lang={lang} />
      </article>

      {ask && (
        <Dialog showTitle title="Replace your changes?" onClose={() => setAsk(null)}>
          <p className="small" style={{ margin: 0 }}>You edited {SECTION_TITLE[ask]}. A new version replaces your changes. This uses your 1 free regenerate.</p>
          <div className="row g8">
            <button type="button" className="btn btn-ink" onClick={() => regen(ask, true)} disabled={!!busy}>Replace my changes</button>
            <button type="button" className="btn btn-outline" onClick={() => setAsk(null)}>Keep my changes</button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function Editor({ value, onChange, rows, hint, max, busy, onSave }) {
  return (
    <div className="stack g8">
      <textarea className="input" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Edit" data-testid="li-pack-editor" />
      <span className="row between g8 xs muted">{hint || ''}{max ? <span style={{ color: value.length > max ? 'var(--danger)' : undefined }}>{value.length.toLocaleString('en-IN')}/{max.toLocaleString('en-IN')}</span> : null}</span>
      <button type="button" className="btn btn-ink" onClick={onSave} disabled={busy} style={{ alignSelf: 'flex-start' }}>Save</button>
    </div>
  );
}

function Banner({ banner, accent, lang }) {
  const ref = useRef(null);
  const toast = useToast();
  useEffect(() => { if (ref.current) drawBanner(ref.current, banner, accent); }, [banner, accent]);
  const download = async () => {
    try { await downloadBanner(banner, accent); } catch { toast('Couldn’t make the image. Please try again.'); }
  };
  return (
    <article className="card stack g8" data-testid="li-pack-banner">
      <h3 className="h4" style={{ margin: 0 }}>Banner</h3>
      <canvas ref={ref} width={BANNER_W} height={BANNER_H} role="img" aria-label={`Banner: ${[banner.name, banner.role].filter(Boolean).join(', ')}`} style={{ width: '100%', height: 'auto', borderRadius: 8, border: '1px solid var(--border)' }} />
      <span className="xs muted">1584 × 396, in your resume’s colours. Your photo covers the bottom-left, so the text sits on the right.</span>
      <button type="button" className="btn btn-outline" data-testid="li-banner-download" onClick={download} style={{ alignSelf: 'flex-start', minHeight: 44 }}>Download banner (PNG)</button>
      <Where section="banner" lang={lang} />
    </article>
  );
}
