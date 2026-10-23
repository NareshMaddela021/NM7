// Path 1, "I have a LinkedIn profile": the link (stored and shown only), then the LinkedIn PDF or pasted sections,
// then the free check: score, a fix per section ("Keep as it is" when it is already good), the keyword match and
// one headline before → after. We never open linkedin.com and never ask for a LinkedIn password.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/ui';
import { importResume } from '../../lib/import';
import { canSave, saveLinkedIn, writeHeadlines } from '../../lib/linkedin/api';
import { LOCKED } from '../../lib/linkedin/guide';
import { headlineFacts, improveHeadline } from '../../lib/linkedin/headlines';
import { roleFrom } from '../../lib/linkedin/keywords';
import { LIMITS, URL_ERROR, emptySections, fromPaste, fromResumeData, hasContent, mergeSections, normalizeUrl } from '../../lib/linkedin/profile';
import { CHECKLIST, checkProfile, scoreLabel } from '../../lib/linkedin/score';
import { CopyButton, Locked, SavePdfPicture, ScoreRing } from './parts';

const NEED_CONTENT = 'To check your profile, upload your LinkedIn PDF or paste your sections. We never open LinkedIn, so a link alone isn’t enough.';

function Counted({ id, label, value, onChange, max, rows = 3, hint, placeholder }) {
  const over = value.length > max;
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <textarea id={id} className="input" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-n`} aria-invalid={over ? 'true' : undefined} />
      <div className="row between g8" style={{ flexWrap: 'wrap' }}>
        <span className="xs muted">{hint}</span>
        {max ? <span id={`${id}-n`} className="xs" style={{ color: over ? 'var(--danger)' : 'var(--text3)' }}>{value.length.toLocaleString('en-IN')}/{max.toLocaleString('en-IN')}</span> : null}
      </div>
    </div>
  );
}

export default function FixPath({ saved }) {
  const [url, setUrl] = useState(saved?.url || '');
  const [urlErr, setUrlErr] = useState('');
  const [role, setRole] = useState(saved?.targetRole || '');
  const [mode, setMode] = useState(saved?.source === 'paste' ? 'paste' : 'pdf');
  // a Re-check uses the PDF text saved last time (no need to upload again)
  const [pdf, setPdf] = useState(saved?.source === 'pdf' && saved.sections ? { name: 'your saved LinkedIn PDF', sections: { ...emptySections(), ...saved.sections }, note: '' } : null); // { name, sections, note }
  const [pdfErr, setPdfErr] = useState('');
  const [reading, setReading] = useState(false);
  const [paste, setPaste] = useState({ headline: '', about: '', experience: '', skills: '', ...(saved?.source === 'paste' ? saved.sections?.pasted : {}) });
  const [checklist, setChecklist] = useState(saved?.result?.checklist || {});
  const [ran, setRan] = useState(null); // { sections, role, url }
  const [msg, setMsg] = useState('');
  const [after, setAfter] = useState({ text: '', notice: '', busy: false });
  const [saveNote, setSaveNote] = useState('');
  const resultRef = useRef(null);

  const onFile = async (file) => {
    if (!file) return;
    setPdfErr(''); setReading(true);
    try {
      const R = await importResume(file, 'linkedin');
      const sections = fromResumeData(R.data);
      const notLinkedIn = R.notes?.find((n) => /isn’t LinkedIn’s profile PDF/.test(n.msg));
      setPdf({ name: file.name, sections, note: notLinkedIn ? 'This doesn’t look like LinkedIn’s “Save to PDF” file. We read it anyway; check the results.' : '' });
    } catch (e) {
      setPdf(null);
      setPdfErr(e?.message || 'We couldn’t read this file. Try saving the PDF again, or paste your sections.');
    } finally { setReading(false); }
  };

  const sectionsNow = () => (mode === 'pdf' ? mergeSections(pdf?.sections, null) : fromPaste(paste));

  const run = async () => {
    setMsg('');
    const norm = normalizeUrl(url);
    if (norm === null) { setUrlErr(URL_ERROR); return; }
    setUrlErr('');
    if (norm) setUrl(norm);
    const sections = sectionsNow();
    if (!hasContent(sections)) { setRan(null); setMsg(NEED_CONTENT); if (norm && canSave()) saveLinkedIn({ url: norm, path: 'fix', targetRole: role }).catch(() => {}); return; }
    const r = roleFrom(role, sections.headline);
    setRan({ sections, role: r, url: norm });
    requestAnimationFrame(() => resultRef.current?.focus());
    // one free headline, before → after: the rules at once, AI's when it answers
    const facts = headlineFacts({ sections, role: r });
    const rules = improveHeadline(sections.headline, facts);
    setAfter({ text: rules, notice: '', busy: canSave() });
    if (canSave()) {
      const res = await writeHeadlines(facts, { count: 1, current: sections.headline }).catch(() => null);
      const ai = res?.headlines?.[0];
      setAfter({ text: ai && ai.toLowerCase() !== sections.headline.toLowerCase() ? ai : rules, notice: res?.notice || '', busy: false });
    }
  };

  const result = ran ? checkProfile(ran.sections, { role: ran.role, url: ran.url, checklist }) : null;

  // keep the latest check on the account (signed-in customers only)
  useEffect(() => {
    if (!result || !canSave()) { setSaveNote(''); return undefined; }
    const t = setTimeout(() => {
      const body = {
        url: ran.url, path: 'fix', targetRole: role, source: mode,
        sections: { ...ran.sections, ...(mode === 'paste' ? { pasted: paste } : {}) },
        result: { score: result.score, top: result.top, keywordLine: result.keywordLine, headlineBefore: ran.sections.headline, headlineAfter: after.text, checklist, checkedAt: Date.now() },
      };
      saveLinkedIn(body).then(() => setSaveNote('Saved to your account.')).catch(() => setSaveNote('Couldn’t save this check. It is still shown here.'));
    }, 600);
    return () => clearTimeout(t);
  }, [ran, checklist, after.text]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack g20">
      <section className="card stack g16" aria-labelledby="li-fix-h">
        <h2 id="li-fix-h" className="h3" style={{ margin: 0 }}>Your profile</h2>
        <div className="field">
          <label className="label" htmlFor="li-url">Your LinkedIn link <span className="xs muted" style={{ fontWeight: 400 }}>· optional</span></label>
          <input id="li-url" className="input" inputMode="url" autoComplete="off" placeholder="linkedin.com/in/your-name" value={url}
            onChange={(e) => { setUrl(e.target.value); setUrlErr(''); }} onBlur={() => { if (normalizeUrl(url) === null) setUrlErr(URL_ERROR); }}
            aria-invalid={urlErr ? 'true' : undefined} aria-describedby="li-url-help" />
          <span id="li-url-help" className="xs" role={urlErr ? 'alert' : undefined} style={{ color: urlErr ? 'var(--danger)' : 'var(--text3)' }}>
            {urlErr || 'We only keep and show your link. We never open your LinkedIn or ask for your password.'}
          </span>
        </div>
        <div className="field">
          <label className="label" htmlFor="li-role">The job you want <span className="xs muted" style={{ fontWeight: 400 }}>· optional</span></label>
          <input id="li-role" className="input" placeholder="e.g. Data Analyst" maxLength={100} value={role} onChange={(e) => setRole(e.target.value)} />
          <span className="xs muted">Empty? We use your headline.</span>
        </div>

        <div className="segmented" role="group" aria-label="How to add your profile" style={{ display: 'flex', flexWrap: 'wrap' }}>
          <button type="button" aria-pressed={mode === 'pdf'} onClick={() => setMode('pdf')}>Upload LinkedIn PDF</button>
          <button type="button" aria-pressed={mode === 'paste'} onClick={() => setMode('paste')}>Paste sections</button>
        </div>

        {mode === 'pdf' ? (
          <div className="stack g12" data-testid="li-pdf">
            <ol className="small stack g4" style={{ margin: 0, paddingLeft: 20 }}>
              <li>Open your profile on LinkedIn.</li>
              <li>Tap <strong>More</strong> under your name.</li>
              <li>Tap <strong>Save to PDF</strong>. LinkedIn downloads your profile.</li>
              <li>Upload that file here.</li>
            </ol>
            <SavePdfPicture />
            <label className="btn btn-outline" style={{ minHeight: 48, gap: 8, alignSelf: 'flex-start', cursor: 'pointer' }}>
              <Icon name="upload" size={18} />{pdf ? 'Choose another PDF' : 'Upload LinkedIn PDF'}
              <input type="file" accept="application/pdf,.pdf" data-testid="li-pdf-input" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            {reading && <span className="small muted" aria-live="polite">Reading your PDF…</span>}
            {pdfErr && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{pdfErr}</span>}
            {pdf && !reading && (
              <span className="small" data-testid="li-pdf-read" aria-live="polite">
                Read {pdf.name}: {pdf.sections.experience.length} role{pdf.sections.experience.length === 1 ? '' : 's'}, {pdf.sections.skills.length} skill{pdf.sections.skills.length === 1 ? '' : 's'}, {pdf.sections.education.length} education. Your phone and email in the PDF are not used.
                {pdf.note && <><br /><span className="muted">{pdf.note}</span></>}
              </span>
            )}
          </div>
        ) : (
          <div className="stack g12" data-testid="li-paste">
            <Counted id="li-p-headline" label="Headline" rows={2} max={LIMITS.headline} value={paste.headline} onChange={(v) => setPaste({ ...paste, headline: v })} hint="The line under your name." />
            <Counted id="li-p-about" label="About" rows={5} max={LIMITS.about} value={paste.about} onChange={(v) => setPaste({ ...paste, about: v })} />
            <Counted id="li-p-exp" label="Experience" rows={5} value={paste.experience} onChange={(v) => setPaste({ ...paste, experience: v })} hint="One role per block, with a blank line between roles. First line: Title at Company." placeholder={'Data Intern at Acme Analytics\nMade weekly sales reports in Excel.'} />
            <Counted id="li-p-skills" label="Skills" rows={2} value={paste.skills} onChange={(v) => setPaste({ ...paste, skills: v })} hint="Separate with commas." />
          </div>
        )}

        <button type="button" className="btn btn-ink btn-lg" data-testid="li-check" onClick={run} disabled={reading} style={{ alignSelf: 'flex-start' }}>Check my profile</button>
        {msg && <p className="small" role="alert" data-testid="li-need" style={{ margin: 0 }}>{msg}</p>}
      </section>

      {result && (
        <section className="stack g16" aria-labelledby="li-res-h" ref={resultRef} tabIndex={-1} data-testid="li-result">
          <div className="card stack g16">
            <h2 id="li-res-h" className="h3" style={{ margin: 0 }}>Your LinkedIn check</h2>
            <ScoreRing score={result.score} label={scoreLabel(result.score)} />
            {result.keywordLine && <p className="small" data-testid="li-keywords" style={{ margin: 0 }}><strong>Keywords · </strong>{result.keywordLine}</p>}
            {!result.keywords.known && ran.role && <p className="xs muted" style={{ margin: 0 }}>We don’t have a keyword list for “{ran.role}” yet. The other checks still apply.</p>}
            <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Tick what your profile already has</legend>
              {CHECKLIST.map((c) => (
                <label key={c.id} className="row g8 small" style={{ alignItems: 'center', minHeight: 40 }}>
                  <input type="checkbox" checked={!!checklist[c.id]} onChange={(e) => setChecklist({ ...checklist, [c.id]: e.target.checked })} style={{ width: 20, height: 20 }} />{c.label}
                </label>
              ))}
            </fieldset>
            {saveNote ? <span className="xs muted" data-testid="li-saved">{saveNote}</span> : !canSave() ? <span className="xs muted" data-testid="li-signin"><Link to="/login?next=%2Flinkedin">Sign in</Link> to keep this check on your account.</span> : null}
          </div>

          <div className="card stack g12" data-testid="li-headline">
            <h3 className="h4" style={{ margin: 0 }}>Your headline, before → after</h3>
            <div className="stack g4">
              <span className="xs muted">Before</span>
              <p style={{ margin: 0 }} data-testid="li-before">{ran.sections.headline || <em className="muted">No headline yet</em>}</p>
            </div>
            <div className="stack g4">
              <span className="xs muted">After{after.busy ? ' · writing…' : ''}</span>
              <p style={{ margin: 0, fontWeight: 600 }} data-testid="li-after">{after.text || <em className="muted">Add your role or skills to get a suggestion.</em>}</p>
              {after.text && <span className="xs faint">{after.text.length}/{LIMITS.headline}</span>}
            </div>
            {after.notice && <span className="xs muted" data-testid="li-ai-notice">{after.notice}</span>}
            <CopyButton text={after.text} label="Copy headline" testid="li-copy-after" />
          </div>

          <div className="stack g12" data-testid="li-fixes">
            {result.items.map((it) => (
              <article key={it.id} className="card stack g8" data-testid={`li-item-${it.id}`}>
                <div className="row between g8" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <h3 className="h4" style={{ margin: 0 }}>{it.title}</h3>
                  <span className="small muted">{it.points}/{it.max}</span>
                </div>
                {it.good ? (
                  <span className="row g8 small" style={{ alignItems: 'center', color: 'var(--success)' }} data-testid="li-keep"><Icon name="check" size={16} />{it.keep}</span>
                ) : (
                  <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {it.issues.map((x) => (
                      <li key={x.what} className="well stack g4">
                        <strong className="small">{x.what}</strong>
                        <span className="xs muted">Why: {x.why}</span>
                        <span className="small">Fix: {x.fix}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>

          <Locked items={LOCKED} />
        </section>
      )}
    </div>
  );
}
