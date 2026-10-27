// Job match (Phase 1) on ATS & job match: paste a job post (or add a screenshot / PDF of it), pick a resume, see the
// score /100 with its breakdown, what's Found / Weak / Missing with honest next steps, then "Tailor this resume"
// (Tailor pack): a copy for the job with suggestions to accept or skip. Saved matches are listed below, and a match
// can be saved to My applications.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spinner, useToast } from '../../components/ui';
import { useMe, setMe, newId, openInBuilder, reloadMe, activeResume } from '../../lib/customerStore';
import { BUY_WA, WA_PAY_TEXT } from '../../lib/waPay';
import { inr, inrExact } from '../../lib/pricing';
import CodeBox from '../../components/CodeBox';
import { PACKS, STATUS_TEXT, VERDICT_TONE, buyPack, decide, getMatch, getTailor, jobAccess, listMatches, matchJob, patchMatch, readPdfText, readScreenshot, startTailor } from '../../lib/jobs';
import { fmtDay } from './shared';
import JobCover from './JobCover';

const KIND_LABEL = { tech: 'Skill', tool: 'Tool', cert: 'Certification', lang: 'Language' };

/** The Tailor / Interview pack offer, following the payment mode (Off: Coming soon). */
export function PackOffer({ kind, acc, onBought, why }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState(null); // a discount code applied
  const pack = PACKS[kind];
  const list = acc?.prices?.[pack.plan];
  const price = quote ? quote.final / 100 : list;
  const onSale = acc?.onSale?.[kind];
  const buy = async () => {
    setBusy(true);
    try {
      const r = await buyPack(kind, acc.mode, quote?.code);
      if (!r?.whatsapp) { toast(`${pack.name} unlocked`); onBought?.(); }
    } catch (e) { toast(e.message || 'Payment didn’t go through. You haven’t been charged.'); } finally { setBusy(false); }
  };
  return (
    <div className="well stack g8" data-testid={`pack-${kind}`}>
      <strong className="small">{pack.name}{list ? ` · ${inr(list)}` : ''}</strong>
      <span className="xs muted">{why ? `${why} ` : ''}{pack.what}{kind === 'tailor' ? ` Included in the ${inr(acc?.prices?.diy ?? 99)} plan.` : ' Included in Career Launch.'}</span>
      {onSale ? (
        <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={buy}>
          {busy && <Spinner />}{acc.mode === 'whatsapp' ? (busy ? 'Opening WhatsApp…' : BUY_WA) : busy ? 'Waiting for your payment…' : `Buy ${inrExact(price)}`}
        </button>
      ) : <span className="btn btn-outline" aria-disabled="true" data-testid={`pack-${kind}-soon`} style={{ alignSelf: 'flex-start', opacity: 0.7, cursor: 'not-allowed' }}>Coming soon</span>}
      {acc && <CodeBox item={pack.plan} onApplied={setQuote} disabled={busy} onUnlocked={() => { toast(`${pack.name} unlocked`); onBought?.(); }} />}
      {onSale && acc.mode === 'whatsapp' && <span className="xs faint">{WA_PAY_TEXT}</span>}
    </div>
  );
}

function Breakdown({ m }) {
  return (
    <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Score breakdown">
      {m.breakdown.map((b) => (
        <li key={b.key} className="stack g4" data-testid={`jm-part-${b.key}`}>
          <span className="row between small"><strong>{b.label}</strong><span>{Math.round(b.points)} / {b.max}</span></span>
          <span aria-hidden="true" style={{ height: 6, borderRadius: 3, background: 'var(--sunken)', overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${(b.points / b.max) * 100}%`, background: b.points / b.max >= 0.7 ? 'var(--success)' : b.points / b.max >= 0.4 ? 'var(--warning)' : 'var(--danger)' }} />
          </span>
          <span className="xs muted">{b.note}</span>
        </li>
      ))}
    </ul>
  );
}

function Items({ m }) {
  const groups = [['found', 'Found in your resume', 'b-success'], ['weak', 'Weak: only listed, not shown in a bullet', 'b-warning'], ['missing', 'Missing', 'b-danger']];
  return (
    <div className="stack g12">
      {groups.map(([st, title, cls]) => {
        const list = m.items.filter((i) => i.status === st);
        if (!list.length) return null;
        return (
          <div key={st} className="stack g8" data-testid={`jm-${st}`}>
            <strong className="small">{title} · {list.length}</strong>
            <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {list.map((i) => (
                <li key={i.name} className="stack g4">
                  <span className="row g8 small" style={{ alignItems: 'center' }}>
                    <span className={`badge ${cls}`}>{STATUS_TEXT[st]}</span>
                    <strong>{i.name}</strong>
                    <span className="xs faint">{KIND_LABEL[i.kind] || 'Skill'}{i.group === 'nice' ? ' · nice to have' : ''}</span>
                  </span>
                  {i.step && <span className="xs muted" style={{ paddingLeft: 4 }}>{i.step}</span>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {m.soft?.length > 0 && <span className="xs muted">They also ask for {m.soft.join(', ')}. Show these with a real example in a bullet or in your cover letter.</span>}
    </div>
  );
}

function Tailor({ m, onScore }) {
  const nav = useNavigate();
  const toast = useToast();
  const [t, setT] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { setBusy(true); try { const r = await fn(); setT(r); onScore?.(r); } catch (e) { toast(e.message); } finally { setBusy(false); } };
  useEffect(() => { if (m.tailoredResumeId) run(() => getTailor(m.id)); }, [m.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) {
    return (
      <button type="button" className="btn btn-ink" data-testid="jm-tailor-start" disabled={busy} onClick={() => run(async () => { const r = await startTailor(m.id); reloadMe(); return r; })}>
        {busy && <Spinner />}{busy ? 'Making your copy…' : 'Tailor this resume'}
      </button>
    );
  }
  const pending = t.suggestions.filter((s) => s.status === 'pending').length;
  return (
    <section className="stack g12" aria-label="Tailored copy" data-testid="jm-tailor">
      <div className="well stack g4">
        <strong className="small">Copy: {t.copy?.name}</strong>
        <span className="xs muted">Your original “{t.original.name}” never changes. Accepted suggestions go into this copy only.</span>
        <span className="small" data-testid="jm-tailor-score">Score: {t.scoreBefore} → <strong>{t.scoreNow}</strong>{pending > 0 ? ` (${t.scoreIfAll} if you accept all)` : ''}</span>
        {t.note && <span className="xs muted">{t.note}</span>}
        <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => { openInBuilder(t.copy.id); nav('/builder', { state: { open: 'build' } }); }}>Open the copy in the builder</button>
      </div>
      {t.suggestions.length === 0 && <span className="small muted">No changes to suggest: your resume already uses the job’s words where it can.</span>}
      {t.suggestions.map((s) => (
        <article key={s.id} className="card stack g8" style={{ padding: 14 }} data-testid="jm-sugg">
          <span className="row between g8"><strong className="small">{s.label}</strong>{s.source === 'ai' && <span className="badge b-neutral">AI, checked</span>}</span>
          <div className="stack g4 small">
            <span className="muted" style={{ textDecoration: s.status === 'accepted' ? 'line-through' : undefined }}><span className="xs faint">Before: </span>{s.before || '(empty)'}</span>
            <span><span className="xs faint">After: </span>{s.after}</span>
          </div>
          {s.status === 'pending' ? (
            <div className="row g8">
              <button type="button" className="btn btn-ink" style={{ minHeight: 38 }} disabled={busy} onClick={() => run(() => decide(m.id, s.id, 'accept'))}>Accept</button>
              <button type="button" className="btn btn-outline" style={{ minHeight: 38 }} disabled={busy} onClick={() => run(() => decide(m.id, s.id, 'skip'))}>Skip</button>
            </div>
          ) : <span className={`badge ${s.status === 'accepted' ? 'b-success' : 'b-neutral'}`} style={{ alignSelf: 'flex-start' }}>{s.status === 'accepted' ? 'Accepted' : 'Skipped'}</span>}
        </article>
      ))}
    </section>
  );
}

function Result({ m, acc, onChange, onBought }) {
  const me = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const [tailored, setTailored] = useState(null);
  const saved = me.apps.find((a) => a.matchId === m.id);
  const saveApp = () => {
    setMe((s) => ({ apps: [...s.apps, { id: newId('a'), company: m.company || 'Company', role: m.title || 'Role', status: 'saved', url: '', notes: '', resumeId: tailored?.copy?.id || m.tailoredResumeId || m.resumeId, next: null, date: Date.now(), matchId: m.id, score: tailored?.scoreNow ?? m.score, tailoredResumeId: tailored?.copy?.id || m.tailoredResumeId || null }] }));
    toast('Saved to My applications');
  };
  return (
    <section className="card stack g16" aria-label="Job match result" data-testid="jm-result">
      <div className="row between g12" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="stack g4">
          {edit ? (
            <form className="row g8" style={{ flexWrap: 'wrap' }} onSubmit={async (e) => { e.preventDefault(); try { onChange(await patchMatch(m.id, edit)); setEdit(null); } catch (x) { toast(x.message); } }}>
              <input className="input" aria-label="Job title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} style={{ height: 38 }} />
              <input className="input" aria-label="Company" value={edit.company} onChange={(e) => setEdit({ ...edit, company: e.target.value })} style={{ height: 38 }} />
              <button type="submit" className="btn btn-outline" style={{ minHeight: 38 }}>Save</button>
            </form>
          ) : (
            <span className="row g8" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
              <strong data-testid="jm-title">{m.title || 'Job'}{m.company ? ` · ${m.company}` : ''}</strong>
              <button type="button" className="link-btn xs" onClick={() => setEdit({ title: m.title, company: m.company })}>Fix title / company</button>
            </span>
          )}
          <span className="xs muted">{[m.location, m.parsed.fresher ? 'Freshers can apply' : m.parsed.expMin != null ? `${m.parsed.expMin}${m.parsed.expMax ? `–${m.parsed.expMax}` : '+'} years` : '', m.parsed.education[0]].filter(Boolean).join(' · ')}{` · checked with ${m.resumeName}`}</span>
        </div>
        <div className="stack g4" style={{ alignItems: 'flex-end' }}>
          <span className="row g8" style={{ alignItems: 'baseline' }}><strong className="display" data-testid="jm-score" style={{ fontSize: 44 }}>{m.score}</strong><span className="muted">/ 100</span></span>
          <span className={`badge b-${VERDICT_TONE[m.verdict] || 'neutral'}`} data-testid="jm-verdict">{m.verdictText}</span>
        </div>
      </div>
      {m.note && <span className="xs muted" role="note">{m.note}</span>}
      {m.fixes?.length > 0 && <div className="stack g4"><strong className="small">Fixes that use what you already have</strong><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{m.fixes.map((f) => <li key={f}>{f}</li>)}</ul></div>}
      <div className="row g16" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 280px' }}><Items m={m} /></div>
        <div style={{ flex: '1 1 260px' }}><Breakdown m={m} /></div>
      </div>
      <div className="stack g8">
        {acc.tailor ? <Tailor m={m} onScore={setTailored} /> : <PackOffer kind="tailor" acc={acc} onBought={onBought} why="Want a copy of your resume tailored to this job?" />}
        <JobCover m={m} acc={acc} onUsed={onBought} offer={<PackOffer kind="tailor" acc={acc} onBought={onBought} why="Come back tomorrow for another free letter, or" />} />
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" data-testid="jm-save-app" disabled={!!saved} onClick={saveApp}>{saved ? 'Saved to My applications' : 'Save to My applications'}</button>
          <button type="button" className="btn btn-outline" data-testid="jm-interview" onClick={() => nav(`/me/interview/${m.id}`)}>Interview prep{m.interview ? ` · ${m.interview.practised} of ${m.interview.total} practised` : ''}</button>
        </div>
      </div>
    </section>
  );
}

export default function JobMatch() {
  const me = useMe();
  const toast = useToast();
  const [acc, setAcc] = useState(null);
  const [rid, setRid] = useState(activeResume(me).id);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [m, setM] = useState(null);
  const [hist, setHist] = useState([]);
  const shot = useRef(null);
  const pdf = useRef(null);
  const refresh = () => { jobAccess().then(setAcc); listMatches().then(setHist).catch(() => {}); };
  useEffect(refresh, []);
  const run = async () => {
    setBusy('match'); setErr('');
    try {
      const r = await matchJob({ resumeId: rid, text });
      setM(r); refresh();
      setTimeout(() => document.querySelector('[data-testid="jm-result"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
    } catch (e) { setErr(e.message); if (e.code === 'free_limit') refresh(); } finally { setBusy(''); }
  };
  const readFile = async (file, kind) => {
    if (!file) return;
    setBusy(kind); setErr('');
    try { setText(kind === 'pdf' ? await readPdfText(file) : await readScreenshot(file)); toast('Job post added - check it, then match'); } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  if (!acc) return <div className="card"><Spinner /></div>;
  const left = acc.free.matchesLeft;
  return (
    <>
      <section className="card stack g12" aria-label="Match a job" data-testid="jm-form">
        <div className="field"><label htmlFor="jm-r" className="label">Resume</label>
          <select id="jm-r" className="input" style={{ height: 42 }} value={rid} onChange={(e) => setRid(e.target.value)}>{me.resumes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <div className="field">
          <label htmlFor="jm-text" className="label">Job post</label>
          <textarea id="jm-text" className="input" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the whole job post: the title, the duties and the skills they ask for." />
          <span className="xs muted">Job links can’t be opened here. Copy the job post’s text and paste it, or add a screenshot or a PDF of it.</span>
        </div>
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" disabled={!!busy} onClick={() => shot.current?.click()}>{busy === 'shot' ? <Spinner /> : null}Add a screenshot</button>
          <button type="button" className="btn btn-outline" disabled={!!busy} onClick={() => pdf.current?.click()}>{busy === 'pdf' ? <Spinner /> : null}Add a PDF</button>
          <input ref={shot} type="file" accept="image/*" hidden aria-label="Job post screenshot" onChange={(e) => { readFile(e.target.files?.[0], 'shot'); e.target.value = ''; }} />
          <input ref={pdf} type="file" accept="application/pdf,.pdf" hidden aria-label="Job post PDF" onChange={(e) => { readFile(e.target.files?.[0], 'pdf'); e.target.value = ''; }} />
        </div>
        {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
        <div className="row between g8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ink" data-testid="jm-go" disabled={!!busy || !text.trim() || left === 0} onClick={run}>{busy === 'match' && <Spinner />}{busy === 'match' ? 'Reading the post…' : 'Match my resume'}</button>
          <span className="xs muted" data-testid="jm-left">{acc.tailor ? 'Unlimited matches with your Tailor pack' : left === 0 ? 'You’ve used today’s free matches' : `${left} of ${acc.free.matchesPerDay} free matches left today`}</span>
        </div>
        {!acc.tailor && left === 0 && <PackOffer kind="tailor" acc={acc} onBought={refresh} why="Come back tomorrow for more free matches, or" />}
      </section>
      {m && <Result key={m.id} m={m} acc={acc} onChange={setM} onBought={refresh} />}
      {hist.length > 0 && (
        <section className="card stack g8" aria-label="Your job matches" data-testid="jm-history">
          <strong className="small">Your job matches</strong>
          <ul className="stack g4" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {hist.map((h) => (
              <li key={h.id} className="row between g8 small" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="link-btn small" style={{ textAlign: 'left' }} onClick={async () => { try { setM(await getMatch(h.id)); } catch (e) { toast(e.message); } }}>{h.title || 'Job'}{h.company ? ` · ${h.company}` : ''}</button>
                <span className="xs muted">{h.score}/100 · {fmtDay(h.createdAt)}{h.tailoredResumeId ? ' · tailored' : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
