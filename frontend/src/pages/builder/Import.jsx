// "Import LinkedIn" and "Rebuild my old resume": upload → reading → review (side by side) → builder.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/ui';
import { FieldGrid, SchemaField } from './Fields';
import { EXP_LEVELS, LISTS, PINFO_FIELDS, DECL_FIELDS } from './schema';
import { TEMPLATE_PRESETS, fmtDate } from './design';
import { applyImport, counts } from '../../lib/import/apply';

const STEPS = ['Reading your file', 'Finding sections', 'Sorting skills into categories', 'Checking dates and details'];
const COPY = {
  linkedin: { title: 'Import your LinkedIn profile', sub: 'Upload the PDF LinkedIn makes from your profile. We fill every section we can — you check it before anything is saved.', accept: '.pdf,application/pdf', types: 'LinkedIn profile PDF' },
  resume: { title: 'Rebuild your old resume', sub: 'Upload your current resume — any layout. We pull everything into clean sections, point out what to fix, and you check it before anything is saved.', accept: '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document', types: 'PDF or Word (.docx)' },
};

/* ---------- small pieces ---------- */
function Conf({ o }) {
  if (o?._conf === 'check') return <span className="badge b-warning" title={o._why}>⚠ Check</span>;
  return <span className="badge b-success">✓ Found</span>;
}
const dateText = (o, a = 'from', b = 'to', cur = 'current') => [fmtDate(o[a], 'mon'), o[cur] ? 'Present' : fmtDate(o[b], 'mon')].filter(Boolean).join(' – ');
const LINE = {
  exp: (e) => [[e.role, e.company].filter(Boolean).join(' · ') || 'Untitled role', dateText(e)],
  edu: (e) => [[[e.degree, e.field].filter(Boolean).join(', '), e.institution, e.grade].filter(Boolean).join(' · '), dateText(e)],
  proj: (p) => [p.title, dateText(p, 'from', 'to', 'ongoing')],
  certs: (c) => [[c.name, c.issuer].filter(Boolean).join(' · '), fmtDate(c.issueDate, 'mon')],
  ach: (a) => [a.title, fmtDate(a.date, 'mon')],
  langs: (l) => [[l.name, l.level && `(${l.level})`].filter(Boolean).join(' '), ''],
};
const TITLES = { exp: 'Experience', edu: 'Education', proj: 'Projects', certs: 'Certifications', ach: 'Achievements', langs: 'Languages' };

function LinkedInGuide() {
  const steps = [
    ['Open your profile', 'On linkedin.com (computer), click Me → View profile.'],
    ['Click “Resources”', 'Below your name, next to Open to and Add profile section. On some accounts this button is called More.'],
    ['Choose “Save to PDF”', 'LinkedIn downloads a file called Profile.pdf. Upload it here.'],
  ];
  return (
    <div className="card stack g12" style={{ padding: 20 }}>
      <strong>How to get your LinkedIn PDF</strong>
      <ol className="stack g12" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {steps.map(([t, d], i) => (
          <li key={t} className="row g12" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <span className="mono" style={{ width: 26, height: 26, flex: 'none', borderRadius: '50%', background: 'var(--ink)', color: 'var(--onink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>{i + 1}</span>
            <span className="stack"><strong className="small">{t}</strong><span className="xs muted">{d}</span></span>
          </li>
        ))}
      </ol>
      <div aria-hidden="true" className="well row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="chip" style={{ minHeight: 30, fontSize: 12 }}>Open to</span>
        <span className="chip" style={{ minHeight: 30, fontSize: 12 }}>Add profile section</span>
        <span className="chip" style={{ minHeight: 30, fontSize: 12, borderColor: 'var(--ink)', borderWidth: 2 }}>Resources ▾</span>
        <span style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 600 }}>⤓ <span className="hl" style={{ padding: '0 2px' }}>Save to PDF</span></span>
      </div>
      <span className="xs faint">LinkedIn doesn’t let other sites read your full profile from a link, so the PDF is the reliable way.</span>
    </div>
  );
}

/* ---------- main ---------- */
export default function Import({ mode, d, onBack, onDone, onPhotos = null }) {
  const c = COPY[mode];
  const [tab, setTab] = useState('file');
  const [phase, setPhase] = useState('upload');
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [errCode, setErrCode] = useState(''); // 'scanned' = a photo or scanned PDF: Snap photos reads those
  const [drag, setDrag] = useState(false);
  const [paste, setPaste] = useState('');
  const [R, setR] = useState(null);
  const [x, setX] = useState(null);
  const [how, setHow] = useState('replace');
  const [open, setOpen] = useState({});
  const inputRef = useRef();
  const topRef = useRef();

  useEffect(() => { window.scrollTo(0, 0); }, [phase]);

  const run = async (input) => {
    setError(''); setErrCode(''); setPhase('reading'); setStep(0);
    try {
      const { importResume } = await import('../../lib/import/index');
      const res = await importResume(input, mode, setStep);
      setR(res);
      setX(JSON.parse(JSON.stringify(res.data)));
      setPhase('review');
    } catch (e) {
      if (!e?.code) console.error('[import]', e);
      setError(e?.message && e.code ? e.message : 'Something went wrong while reading this file. Try another copy, or paste the text instead.');
      setErrCode(e?.code || '');
      setPhase('upload');
    }
  };
  const onFile = (f) => { if (f) run(f); };

  /* ---------- upload ---------- */
  if (phase === 'upload') {
    return (
      <main ref={topRef} className="container stack g24 rise" style={{ maxWidth: 1100, padding: '48px 24px 72px' }}>
        <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={onBack}><Icon name="back" size={16} />Back</button>
        <div className="stack g8" style={{ maxWidth: 720 }}>
          <h1 className="display" style={{ fontSize: 'clamp(32px,4.4vw,48px)' }}>{c.title}</h1>
          <p className="lead">{c.sub}</p>
        </div>
        <div className="row g24" style={{ alignItems: 'flex-start' }}>
          <div className="stack g16" style={{ flex: '2 1 420px' }}>
            <div className="segmented" role="tablist" aria-label="How to import" style={{ alignSelf: 'flex-start' }}>
              <button type="button" role="tab" aria-selected={tab === 'file'} onClick={() => setTab('file')}>Upload file</button>
              <button type="button" role="tab" aria-selected={tab === 'paste'} onClick={() => setTab('paste')}>Paste text</button>
            </div>
            {tab === 'file' ? (
              <label
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}
                className="card stack g12" style={{ alignItems: 'center', textAlign: 'center', padding: '48px 24px', cursor: 'pointer', borderStyle: 'dashed', borderWidth: 2, borderColor: drag ? 'var(--ink)' : 'var(--border2)', background: drag ? 'var(--sunken)' : undefined }}>
                <span style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--signal)', color: 'var(--signalink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="upload" size={26} /></span>
                <strong style={{ fontSize: 18 }}>Drop your {mode === 'linkedin' ? 'LinkedIn PDF' : 'resume'} here, or <span style={{ textDecoration: 'underline' }}>choose a file</span></strong>
                <span className="small muted">{c.types} · up to 5 MB</span>
                <input ref={inputRef} type="file" accept={c.accept} className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            ) : (
              <div className="card stack g12" style={{ padding: 20 }}>
                <label htmlFor="imp-paste" className="label">Paste your resume or LinkedIn text</label>
                <textarea id="imp-paste" className="input" rows={12} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Sai Varsha\nsaivarsha@example.com · +91 98765 43210\n\nEducation\nB.Tech, Computer Science — Anna University   2021 – 2025\n\nSkills\nPython, SQL, Power BI'} />
                <span className="xs faint">Keep the section titles (Education, Experience, Skills…) — they help us sort everything.</span>
                <button type="button" className="btn btn-ink btn-lg" style={{ alignSelf: 'flex-start' }} disabled={paste.trim().length < 40} onClick={() => run({ text: paste })}>Read my text <Icon name="arrow" /></button>
              </div>
            )}
            {error && (
              <div role="alert" className="card small stack g8" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', padding: 16 }}>
                <span>{error}</span>
                {errCode === 'scanned' && onPhotos && <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={onPhotos} data-testid="import-snap-photos">Snap photos instead</button>}
              </div>
            )}
            <div className="well stack g4 small">
              <strong>Your file stays private</strong>
              <span className="muted">Read on your device — never uploaded. Only the details you accept are added to your resume.</span>
            </div>
          </div>
          <div className="stack g16" style={{ flex: '1 1 300px' }}>
            {mode === 'linkedin' ? <LinkedInGuide /> : (
              <div className="card stack g12" style={{ padding: 20 }}>
                <strong>What we can read</strong>
                {[['One or two columns', 'Sidebars are read in the right order.'], ['Any section names', '“Academic Details” → Education, “Key Skills” → Skills, and so on.'], ['Indian formats', 'Class 10/12, CGPA or %, personal details and declaration.'], ['Dates in any style', 'Jun’23, 06/2023, 2021 – Present…']].map(([t, s]) => (
                  <span key={t} className="row g8" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><Icon name="check" size={16} color="var(--success)" stroke={3} /><span className="stack"><strong className="small">{t}</strong><span className="xs muted">{s}</span></span></span>
                ))}
                <span className="xs faint">Photo or scanned resumes: use “Snap photos” on the start screen, which reads photos. Here, paste the text.</span>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  /* ---------- reading ---------- */
  if (phase === 'reading') {
    return (
      <main ref={topRef} className="container stack g24 rise" style={{ maxWidth: 560, padding: '96px 24px', alignItems: 'center', textAlign: 'center' }} aria-live="polite">
        <h1 className="display" style={{ fontSize: 36 }}>Reading your {mode === 'linkedin' ? 'profile' : 'resume'}…</h1>
        <ol className="card stack g12" style={{ listStyle: 'none', margin: 0, padding: 24, width: '100%', textAlign: 'left' }}>
          {STEPS.map((s, i) => (
            <li key={s} className="row g12" style={{ flexWrap: 'nowrap', opacity: i > step ? 0.45 : 1 }}>
              <span style={{ width: 22, height: 22, flex: 'none', borderRadius: '50%', border: `2px solid ${i < step ? 'var(--success)' : 'var(--border2)'}`, background: i < step ? 'var(--success)' : 'transparent', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {i < step ? <Icon name="check" size={12} stroke={3} /> : i === step ? <span className="spin" aria-hidden="true" style={{ width: 12, height: 12 }} /> : null}
              </span>
              <span className={i === step ? 'strong' : ''}>{s}</span>
            </li>
          ))}
        </ol>
      </main>
    );
  }

  /* ---------- review ---------- */
  const setP = (k, v) => setX((p) => ({ ...p, personal: { ...p.personal, [k]: v } }));
  const setItem = (k, i, patch) => setX((p) => ({ ...p, [k]: p[k].map((o, j) => (j === i ? { ...o, ...patch } : o)) }));
  const checks = [
    ...['exp', 'edu', 'proj', 'certs', 'ach'].flatMap((k) => (x[k] || []).map((o, i) => (o._conf === 'check' && o._on !== false ? `${k}-${i}` : null))).filter(Boolean),
    ...['name', 'email', 'phone'].filter((k) => !x.personal[k]).map(() => 'personal'),
  ];
  const jump = () => { const id = checks[0]; if (id) document.getElementById(`rv-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  const found = counts(x);
  const NOTE = { warn: ['⚠', 'var(--warning)'], tip: ['✦', 'var(--accent)'], info: ['ℹ', 'var(--text2)'] };
  const suggest = R.suggest && TEMPLATE_PRESETS[R.suggest];

  const listCard = (k) => (x[k]?.length ? (
    <section key={k} className="card stack g12" style={{ padding: 20 }}>
      <div className="row between g8"><strong>{TITLES[k]}</strong><span className="xs muted">{x[k].filter((o) => o._on !== false).length} of {x[k].length} selected</span></div>
      {x[k].map((o, i) => {
        const [main, date] = LINE[k](o);
        const on = o._on !== false;
        const isOpen = open[`${k}-${i}`];
        return (
          <div key={i} id={`rv-${k}-${i}`} className="stack g8" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, opacity: on ? 1 : 0.5 }}>
            <div className="row g12" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <input type="checkbox" checked={on} onChange={(e) => setItem(k, i, { _on: e.target.checked })} aria-label={`Include ${main}`} style={{ width: 18, height: 18, marginTop: 3, accentColor: 'var(--ink)', flex: 'none' }} />
              <span className="stack g4" style={{ flex: 1, minWidth: 0 }}>
                <span className="strong small" style={{ overflowWrap: 'anywhere' }}>{main || <span className="faint">(empty)</span>}</span>
                {date && <span className="xs muted">{date}</span>}
                {o.description && !isOpen && <span className="xs faint" style={{ overflowWrap: 'anywhere' }}>{o.description.split('\n').length} line{o.description.split('\n').length > 1 ? 's' : ''} · {o.description.split('\n')[0].slice(0, 90)}{o.description.length > 90 ? '…' : ''}</span>}
                {o._conf === 'check' && <span className="xs" style={{ color: 'var(--warning)' }}>{o._why}</span>}
              </span>
              {k !== 'langs' && <Conf o={o} />}
              <button type="button" className="btn btn-ghost" style={{ minHeight: 36, fontSize: 13 }} aria-expanded={!!isOpen} onClick={() => setOpen((p) => ({ ...p, [`${k}-${i}`]: !isOpen }))}>{isOpen ? 'Done' : 'Edit'}</button>
            </div>
            {isOpen && (
              <div className="well"><FieldGrid>
                {LISTS[k].fields.map((f) => <SchemaField key={f.key} field={f} idBase={`rv-${k}-${i}`} value={o[f.key]} disabled={f.disabledBy ? !!o[f.disabledBy] : false} onChange={(v) => setItem(k, i, { [f.key]: v, _conf: 'ok' })} />)}
              </FieldGrid></div>
            )}
          </div>
        );
      })}
    </section>
  ) : null);

  const PF = [['name', 'Full name', true], ['headline', 'Headline'], ['email', 'Email', true], ['phone', 'Phone', true], ['location', 'City / location']];

  return (
    <main ref={topRef} className="container-wide stack g20 rise" style={{ padding: '32px 24px 96px' }}>
      <div className="row between g16" style={{ alignItems: 'flex-end' }}>
        <div className="stack g8" style={{ maxWidth: 760 }}>
          <span className="mono faint" style={{ fontSize: 12 }}>CHECK BEFORE WE SAVE · {R.fileName}</span>
          <h1 className="display" style={{ fontSize: 'clamp(30px,4vw,44px)' }}>Here’s what we found</h1>
          <p className="muted">Untick anything you don’t want. Click Edit to fix a detail. Nothing is saved until you continue.</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => { setPhase('upload'); setR(null); }}>Try another file</button>
      </div>

      <div className="row g20" style={{ alignItems: 'flex-start' }}>
        {/* original */}
        <aside aria-label="Your original file" className="stack g8 sticky" style={{ flex: '1 1 320px', maxWidth: 460, top: 88, maxHeight: 'calc(100vh - 110px)', overflow: 'auto' }}>
          <span className="xs muted strong">Your original{R.pages > 1 ? ` · ${R.pages} pages` : ''}</span>
          {R.thumbs?.length ? R.thumbs.map((src, i) => <img key={i} src={src} alt={`Page ${i + 1} of your original file`} style={{ width: '100%', borderRadius: 6, boxShadow: 'var(--shadow)', background: '#fff' }} />)
            : <div className="well small muted">A page preview isn’t available for {R.source === 'docx' ? 'Word files' : 'pasted text'} yet. Everything we read is on the right.</div>}
        </aside>

        {/* what we read */}
        <div className="stack g16" style={{ flex: '2 1 520px', minWidth: 0 }}>
          <section className="card stack g12" style={{ padding: 20, border: '2px solid var(--ink)' }}>
            <div className="row between g12">
              <strong style={{ fontSize: 18 }}>{found.length ? `Found ${found.join(' · ')}` : 'We found only a little text'}</strong>
              {checks.length > 0 && <button type="button" className="btn btn-outline" style={{ minHeight: 40 }} onClick={jump}>⚠ {checks.length} to check — jump</button>}
            </div>
            {R.sectionsFound?.length > 0 && <span className="xs muted">Sections in your file: {R.sectionsFound.join(', ')}</span>}
            <div className="stack g8">
              {R.notes.map((n, i) => (
                <div key={i} className="row g8 small" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <span aria-hidden="true" style={{ color: NOTE[n.kind][1], fontWeight: 700, width: 16, flex: 'none' }}>{NOTE[n.kind][0]}</span>
                  <span style={{ color: n.kind === 'warn' ? 'var(--warning)' : undefined }}>{n.msg}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card stack g12" style={{ padding: 20 }} id="rv-personal">
            <strong>Personal info</strong>
            <FieldGrid>
              {PF.map(([k, l, req]) => (
                <div key={k} className="field">
                  <label htmlFor={`rvp-${k}`} className="label row between g8"><span>{l}</span>{x.personal[k] ? <span className="xs" style={{ color: 'var(--success)' }}>✓</span> : req ? <span className="xs" style={{ color: 'var(--danger)' }}>Not found</span> : null}</label>
                  <input id={`rvp-${k}`} className="input" value={x.personal[k] || ''} onChange={(e) => setP(k, e.target.value)} />
                </div>
              ))}
              <SchemaField field={{ key: 'level', label: 'Experience level (from your dates)', type: 'select', options: EXP_LEVELS }} idBase="rvp" value={x.personal.level} onChange={(v) => setP('level', v)} />
            </FieldGrid>
            {Object.values(x.links).some(Boolean) && (
              <div className="stack g4">
                <span className="label">Links</span>
                {Object.entries(x.links).filter(([, v]) => v).map(([k, v]) => (
                  <span key={k} className="row g8 small" style={{ flexWrap: 'nowrap' }}><span className="badge b-neutral" style={{ textTransform: 'capitalize' }}>{k}</span><span style={{ overflowWrap: 'anywhere' }}>{v}</span>
                    <button type="button" className="btn btn-ghost" style={{ minHeight: 32, fontSize: 12, marginLeft: 'auto' }} onClick={() => setX((p) => ({ ...p, links: { ...p.links, [k]: '' } }))}>Remove</button></span>
                ))}
              </div>
            )}
          </section>

          {x.summary && (
            <section className="card stack g8" style={{ padding: 20 }}>
              <div className="row between g8"><strong>Summary</strong><span className={`badge ${x.summary.length > 450 ? 'b-warning' : 'b-success'}`}>{x.summary.length} characters</span></div>
              <textarea className="input" rows={5} aria-label="Summary" value={x.summary} onChange={(e) => setX((p) => ({ ...p, summary: e.target.value }))} />
            </section>
          )}

          {['exp', 'edu'].map(listCard)}

          {x.skillGroups?.length > 0 && (
            <section className="card stack g12" style={{ padding: 20 }}>
              <strong>Skills · sorted into categories</strong>
              {x.skillGroups.map((g, i) => (
                <div key={g.id} className="stack g4">
                  <label htmlFor={`rvs-${i}`} className="label">{g.label}</label>
                  <input id={`rvs-${i}`} className="input" value={g.value} onChange={(e) => setX((p) => ({ ...p, skillGroups: p.skillGroups.map((s, j) => (j === i ? { ...s, value: e.target.value } : s)) }))} />
                </div>
              ))}
              <span className="xs faint">You can move skills between categories in the builder.</span>
            </section>
          )}

          {['proj', 'certs', 'ach', 'langs'].map(listCard)}

          {x.custom?.map((cs, ci) => (
            <section key={ci} className="card stack g8" style={{ padding: 20, opacity: cs._on === false ? 0.5 : 1 }}>
              <label className="row g8" style={{ cursor: 'pointer' }}><input type="checkbox" checked={cs._on !== false} onChange={(e) => setX((p) => ({ ...p, custom: p.custom.map((s, j) => (j === ci ? { ...s, _on: e.target.checked } : s)) }))} style={{ width: 18, height: 18, accentColor: 'var(--ink)' }} /><strong>{cs.title}</strong><span className="badge b-neutral">Extra section</span></label>
              {cs.items.map((it, ii) => <span key={ii} className="small muted" style={{ overflowWrap: 'anywhere' }}>{[it.title, it.subtitle, it.date].filter(Boolean).join(' · ')}{it.description ? ` ${it.description.slice(0, 160)}${it.description.length > 160 ? '…' : ''}` : ''}</span>)}
            </section>
          ))}

          {(x.hobbies || x.strengths) && (
            <section className="card stack g8" style={{ padding: 20 }}>
              {x.hobbies && <><strong>Hobbies</strong><span className="small">{x.hobbies.split('\n').join(' · ')}</span></>}
              {x.strengths && <><strong>Strengths</strong><span className="small">{x.strengths.split('\n').join(' · ')}</span></>}
            </section>
          )}
          {Object.values(x.pinfo || {}).some(Boolean) && (
            <section className="card stack g8" style={{ padding: 20 }}>
              <strong>Personal information</strong>
              {PINFO_FIELDS.filter((f) => x.pinfo[f.key]).map((f) => <span key={f.key} className="small"><span className="muted">{f.label}:</span> {x.pinfo[f.key]}</span>)}
              <span className="xs faint">This section will be switched on. Private companies and MNCs usually don’t need it — you can turn it off any time.</span>
            </section>
          )}
          {x.decl && (
            <section className="card stack g8" style={{ padding: 20 }}>
              <strong>Declaration</strong>
              <span className="small">{x.decl.text}</span>
              <span className="xs muted">{DECL_FIELDS.slice(1, 3).map((f) => `${f.label}: ${x.decl[f.key] || '(blank — fill by hand)'}`).join(' · ')}</span>
            </section>
          )}

          {/* apply */}
          <section className="card stack g16" style={{ padding: 20 }}>
            <strong>How should we use this?</strong>
            <div role="radiogroup" aria-label="Replace or add" className="grid-auto g8" style={{ '--min': '240px' }}>
              {[['replace', 'Start fresh with this file', 'Replaces what’s in the builder now. Your design stays.'],
                ['merge', 'Add to what I already have', 'Keeps everything there, fills empty fields and adds new entries. Duplicates are skipped.']].map(([v, t, s]) => (
                <label key={v} className="option" data-on={how === v}>
                  <input type="radio" name="imp-how" checked={how === v} onChange={() => setHow(v)} />
                  <span className="stack g4"><strong className="small">{t}</strong><span className="xs muted">{s}</span></span>
                </label>
              ))}
            </div>
            {suggest && <span className="small">Suggested template: <strong>{suggest.name}</strong> — {R.suggest === 'kio' ? 'your file has personal details / a declaration, which Kio is made for.' : R.suggest === 'fresher' ? 'puts projects first, best with little work history.' : 'clean and modern for experienced profiles.'} You can pick any template next.</span>}
            <div className="row g8">
              <button type="button" className="btn btn-ink btn-lg" onClick={() => onDone(applyImport(d, x, how), R.suggest)}>Use these details <Icon name="arrow" /></button>
              <button type="button" className="btn btn-ghost" onClick={onBack}>Cancel</button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
