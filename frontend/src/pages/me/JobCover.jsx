// "Write cover letter" on the match screen (Phase 2): pick a length and a tone, add the hiring manager's name if
// known, and get a letter built only from the resume (the facts it uses are highlighted), a subject line, and a
// cold email / LinkedIn message under 300 characters. PDF and Word use the resume's template; letters are saved
// with the job. Free: 1 a day; unlimited with the Tailor pack.
import { useState } from 'react';
import { Spinner, useToast } from '../../components/ui';
import { useMe, setMe, newId } from '../../lib/customerStore';
import { deleteCover, writeCover } from '../../lib/jobs';
import { downloadResume } from './shared';

const LENGTHS = [['short', 'Short email (80-120 words)'], ['standard', 'Standard (200-250 words)'], ['formal', 'Formal letter']];
const MIN_WORDS = { short: 80, standard: 200, formal: 200 };
const TONES = [['fresher', 'Fresher'], ['experienced', 'Experienced'], ['switch', 'Career switch'], ['returning', 'Returning after a break']];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A paragraph with the resume facts it uses marked. */
export function Marked({ text, terms }) {
  const list = [...new Set(terms.filter((t) => t && t.length > 1))].sort((a, b) => b.length - a.length);
  if (!list.length) return text;
  const re = new RegExp(`(${list.map(esc).join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="fact">{part}</mark> : part));
}

async function copy(text, toast, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toast('Select the text and copy it by hand'); }
}

export default function JobCover({ m, acc, onUsed, offer }) {
  const me = useMe();
  const toast = useToast();
  const [form, setForm] = useState({ length: 'standard', tone: 'fresher', manager: '' });
  const [letters, setLetters] = useState(m.covers || []);
  const [cur, setCur] = useState((m.covers || [])[0] || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const left = acc.free.coversLeft;
  const locked = !acc.tailor && left === 0;
  const resume = me.resumes.find((r) => r.id === cur?.resumeId) || me.resumes.find((r) => r.id === m.resumeId) || me.resumes[0];
  const write = async () => {
    setBusy(true); setErr('');
    try {
      const c = await writeCover(m.id, form);
      setLetters((l) => [c, ...l]); setCur(c); onUsed?.();
    } catch (e) { setErr(e.message); if (e.code === 'free_limit') onUsed?.(); } finally { setBusy(false); }
  };
  const asCover = (c) => ({ company: m.company, role: m.title, manager: c.manager || '[Hiring Manager]', body: c.paragraphs.join('\n\n'), subject: true, close: c.close, jd: '' });
  const download = async (fmt) => { if (await downloadResume(resume.data, fmt, asCover(cur))) toast(fmt === 'pdf' ? 'PDF ready' : 'Word file ready'); };
  const saveToCovers = () => {
    setMe((s) => ({ covers: [{ id: newId('c'), resumeId: resume.id, at: Date.now(), ...asCover(cur) }, ...s.covers] }));
    toast('Saved to Cover letters');
  };
  const remove = async (c) => {
    try { await deleteCover(m.id, c.id); const rest = letters.filter((x) => x.id !== c.id); setLetters(rest); setCur(rest[0] || null); } catch (e) { toast(e.message); }
  };
  const terms = cur ? [...(cur.used || []), ...(cur.used || []).map((u) => u.slice(0, 40)), ...(cur.skills || [])] : [];
  return (
    <section className="stack g12" aria-label="Cover letter" data-testid="jc">
      <strong>Write cover letter</strong>
      <div className="row g12" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="jc-len" className="label">Length</label>
          <select id="jc-len" className="input" style={{ height: 42 }} value={form.length} onChange={(e) => setForm({ ...form, length: e.target.value })}>{LENGTHS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
        <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="jc-tone" className="label">Tone</label>
          <select id="jc-tone" className="input" style={{ height: 42 }} value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })}>{TONES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
        <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="jc-mgr" className="label">Hiring manager’s name (if you know it)</label>
          <input id="jc-mgr" className="input" maxLength={80} value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} placeholder="Leave empty if you don’t know" /></div>
      </div>
      {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
      <div className="row between g8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ink" data-testid="jc-go" disabled={busy || locked} onClick={write}>{busy && <Spinner />}{busy ? 'Writing your letter…' : 'Write cover letter'}</button>
        <span className="xs muted" data-testid="jc-left">{acc.tailor ? 'Unlimited letters with your Tailor pack' : left === 0 ? 'You’ve used today’s free cover letter' : `${left} free cover letter left today`}</span>
      </div>
      {locked && offer}
      {cur && (
        <article className="card stack g12" style={{ padding: 16 }} data-testid="jc-letter">
          <span className="row between g8" style={{ flexWrap: 'wrap' }}>
            <span className="xs muted">{cur.words} words · {LENGTHS.find(([v]) => v === cur.length)?.[1].split(' (')[0]} · {TONES.find(([v]) => v === cur.tone)?.[1]}</span>
            {cur.source === 'ai' ? <span className="badge b-neutral">AI, checked against your resume</span> : <span className="badge b-neutral">Written from your resume</span>}
          </span>
          {cur.words < MIN_WORDS[cur.length] && <span className="xs muted" data-testid="jc-short">Shorter than the {MIN_WORDS[cur.length]}+ words this length aims for: we only use what’s on your resume. Add one more real example in your own words if you like.</span>}
          {cur.reminder && <p className="small" role="note" data-testid="jc-reminder" style={{ margin: 0, color: 'var(--warning-ink, var(--warning))' }}>{cur.reminder}</p>}
          {cur.note && <span className="xs muted">{cur.note}</span>}
          <div className="small stack g8" data-testid="jc-body" style={{ lineHeight: 1.6 }}>
            <p style={{ margin: 0 }} className="faint">Subject: {cur.subject}</p>
            <p style={{ margin: 0 }}>{cur.greeting}</p>
            {cur.paragraphs.map((p) => <p key={p} style={{ margin: 0 }}><Marked text={p} terms={terms} /></p>)}
            <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{cur.close}{'\n'}{resume?.data?.personal?.name || ''}</p>
          </div>
          <span className="xs muted"><mark className="fact">Marked</mark> words come from your resume. Check every line before you send it.</span>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline" onClick={() => download('pdf')}>PDF</button>
            <button type="button" className="btn btn-outline" onClick={() => download('docx')}>Word</button>
            <button type="button" className="btn btn-outline" data-testid="jc-copy-email" onClick={() => copy(`Subject: ${cur.subject}\n\n${cur.email}`, toast, 'Email')}>Copy as email</button>
            <button type="button" className="btn btn-outline" onClick={saveToCovers}>Save to Cover letters</button>
          </div>
          <div className="well stack g8" data-testid="jc-cold">
            <strong className="small">Cold email / LinkedIn message · {cur.cold.length} / 300 characters</strong>
            <span className="small">{cur.cold}</span>
            <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start', minHeight: 38 }} onClick={() => copy(cur.cold, toast, 'Message')}>Copy message</button>
          </div>
        </article>
      )}
      {letters.length > 0 && (
        <ul className="stack g4" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Letters for this job" data-testid="jc-saved">
          {letters.map((c) => (
            <li key={c.id} className="row between g8 small" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="link-btn small" onClick={() => setCur(c)} aria-current={cur?.id === c.id || undefined}>{TONES.find(([v]) => v === c.tone)?.[1]} · {c.words} words</button>
              <button type="button" className="link-btn xs" style={{ color: 'var(--danger)' }} onClick={() => remove(c)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
