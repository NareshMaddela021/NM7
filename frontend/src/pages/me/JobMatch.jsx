// Job match (Phase 1) on ATS & job match: paste a job post (or add a screenshot / PDF of it), pick a resume, see the
// score /100 with its breakdown, what's Found / Weak / Missing with honest next steps, then "Tailor this resume"
// (Tailor pack): a copy for the job with suggestions to accept or skip. Saved matches are listed below, and a match
// can be saved to My applications.
import ShareWhatsApp from '../../components/ShareWhatsApp';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spinner, useToast } from '../../components/ui';
import { useMe, setMe, newId, openInBuilder, reloadMe, activeResume } from '../../lib/customerStore';
import { PAY_SOON, payErrorLine } from '../../lib/payMode';
import { inr, inrExact } from '../../lib/pricing';
import CodeBox from '../../components/CodeBox';
import { PACKS, STATUS_TEXT, VERDICT_TONE, buyPack, decide, getMatch, getTailor, jobAccess, listMatches, matchJob, patchMatch, readPdfText, readScreenshot, startTailor } from '../../lib/jobs';
import { fmtDay } from './shared';
import { Chip, Empty, ScoreRing, Skel, StickyBar } from './kit';
import '../../styles/me-resume.css';
import JobCover from './JobCover';
import SkillGap from './SkillGap';
import PassOffer from '../../components/PassOffer';

const KIND_LABEL = { tech: 'Skill', tool: 'Tool', cert: 'Certification', lang: 'Language' };

/** The Tailor / Interview pack offer, following the payment mode (Off: Payments coming soon). */
export function PackOffer({ kind, acc, onBought, why }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState(null); // a discount code applied
  const pack = PACKS[kind];
  const list = acc?.prices?.[pack.plan];
  const price = quote ? quote.final / 100 : list;
  const onSale = acc?.onSale?.[kind];
  const buy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await buyPack(kind, quote?.code);
      toast(`${pack.name} unlocked`); onBought?.();
    } catch (e) { toast(payErrorLine(e)); } finally { setBusy(false); }
  };
  return (
    <div className="well stack g8" data-testid={`pack-${kind}`}>
      <strong className="small">{pack.name}{list ? ` · ${inr(list)}` : ''}</strong>
      <span className="xs muted">{why ? `${why} ` : ''}{pack.what}{kind === 'tailor' ? ` Included in the ${inr(acc?.prices?.diy ?? 99)} plan.` : ' Included in Career Launch.'}</span>
      {onSale ? (
        <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={buy}>
          {busy && <Spinner />}{busy ? 'Waiting for your payment…' : `Buy ${inrExact(price)}`}
        </button>
      ) : <span className="btn btn-outline" aria-disabled="true" data-testid={`pack-${kind}-soon`} style={{ alignSelf: 'flex-start', opacity: 0.7, cursor: 'not-allowed' }}>{PAY_SOON}</span>}
      {acc && <CodeBox item={pack.plan} onApplied={setQuote} disabled={busy} onUnlocked={() => { toast(`${pack.name} unlocked`); onBought?.(); }} />}
      <PassOffer compact onBought={onBought} />
    </div>
  );
}

function Breakdown({ m }) {
  return (
    <ul className="mlist jm-break" aria-label="Score breakdown">
      {m.breakdown.map((b) => {
        const r = b.points / b.max;
        return (
          <li key={b.key} className="mbar-wrap" data-testid={`jm-part-${b.key}`}>
            <span className="mbar-row"><span className="mbar-label">{b.label}</span><span className="mbar-val">{Math.round(b.points)} / {b.max}</span></span>
            <span className={`mbar mbar-${r >= 0.7 ? 'ok' : r >= 0.4 ? 'warn' : 'bad'}`} aria-hidden="true"><span style={{ width: `${r * 100}%` }} /></span>
            <span className="mitem-meta">{b.note}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Items({ m }) {
  const groups = [['found', 'Found in your resume', 'b-success'], ['weak', 'Weak: only listed, not shown in a bullet', 'b-warning'], ['missing', 'Missing', 'b-danger']];
  return (
    <div className="mstack jm-items" style={{ gap: 12 }}>
      {groups.map(([st, title, cls]) => {
        const list = m.items.filter((i) => i.status === st);
        if (!list.length) return null;
        return (
          <div key={st} className={`jm-group jm-group-${st}`} data-testid={`jm-${st}`}>
            <strong className="jm-group-h">{title} · {list.length}</strong>
            <ul className="mlist" style={{ gap: 8 }}>
              {list.map((i) => (
                <li key={i.name} className="jm-item">
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
      <button type="button" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} data-testid="jm-tailor-start" disabled={busy} onClick={() => run(async () => { const r = await startTailor(m.id); reloadMe(); return r; })}>
        {busy && <Spinner />}{busy ? 'Making your copy…' : 'Tailor this resume'}
      </button>
    );
  }
  const pending = t.suggestions.filter((s) => s.status === 'pending').length;
  return (
    <section className="stack g12" aria-label="Tailored copy" data-testid="jm-tailor">
      <div className="mcard mcard-accent mcard-tight">
        <strong>Copy: {t.copy?.name}</strong>
        <span className="xs muted">Your original “{t.original.name}” never changes. Accepted suggestions go into this copy only.</span>
        <span className="small" data-testid="jm-tailor-score">Score: {t.scoreBefore} → <strong>{t.scoreNow}</strong>{pending > 0 ? ` (${t.scoreIfAll} if you accept all)` : ''}</span>
        {t.note && <span className="xs muted">{t.note}</span>}
        <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => { openInBuilder(t.copy.id); nav('/builder', { state: { open: 'build' } }); }}>Open the copy in the builder</button>
      </div>
      {t.suggestions.length === 0 && <span className="small muted">No changes to suggest: your resume already uses the job’s words where it can.</span>}
      {t.suggestions.map((s) => (
        <article key={s.id} className="mcard mcard-tight mcard-flat jm-sugg" data-testid="jm-sugg">
          <span className="row between g8"><strong className="small">{s.label}</strong>{s.source === 'ai' && <span className="badge b-neutral">AI, checked</span>}</span>
          <div className="jm-diff small">
            <span className="jm-before" style={{ textDecoration: s.status === 'accepted' ? 'line-through' : undefined }}><span className="xs faint">Before: </span>{s.before || '(empty)'}</span>
            <span className="jm-after"><span className="xs faint">After: </span>{s.after}</span>
          </div>
          {s.status === 'pending' ? (
            <div className="row g8">
              <button type="button" className="btn btn-signal" disabled={busy} onClick={() => run(() => decide(m.id, s.id, 'accept'))}>Accept</button>
              <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(() => decide(m.id, s.id, 'skip'))}>Skip</button>
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
    <section className="mcard jm-result" aria-label="Job match result" data-testid="jm-result">
      <div className="jm-hero">
        <div className="jm-ring">
          <ScoreRing value={m.score} label="Job match score" size={132} />
          <strong className="jm-ring-num" data-testid="jm-score">{m.score}</strong>
        </div>
        <div className="mstack" style={{ gap: 6, flex: '1 1 240px' }}>
          <span className={`badge b-${VERDICT_TONE[m.verdict] || 'neutral'} jm-verdict`} data-testid="jm-verdict">{m.verdictText}</span>
          {edit ? (
            <form className="row g8" style={{ flexWrap: 'wrap' }} onSubmit={async (e) => { e.preventDefault(); try { onChange(await patchMatch(m.id, edit)); setEdit(null); } catch (x) { toast(x.message); } }}>
              <input className="input" aria-label="Job title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} style={{ height: 38 }} />
              <input className="input" aria-label="Company" value={edit.company} onChange={(e) => setEdit({ ...edit, company: e.target.value })} style={{ height: 38 }} />
              <button type="submit" className="btn btn-outline" style={{ minHeight: 38 }}>Save</button>
            </form>
          ) : (
            <span className="row g8" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
              <strong className="jm-title" data-testid="jm-title">{m.title || 'Job'}{m.company ? ` · ${m.company}` : ''}</strong>
              <button type="button" className="link-btn xs" onClick={() => setEdit({ title: m.title, company: m.company })}>Fix title / company</button>
            </span>
          )}
          <span className="mitem-meta">{[m.location, m.parsed.fresher ? 'Freshers can apply' : m.parsed.expMin != null ? `${m.parsed.expMin}${m.parsed.expMax ? `–${m.parsed.expMax}` : '+'} years` : '', m.parsed.education[0]].filter(Boolean).join(' · ')}{` · checked with ${m.resumeName}`}</span>
        </div>
      </div>
      {m.note && <span className="xs muted" role="note">{m.note}</span>}
      {m.fixes?.length > 0 && (
        <div className="mcard mcard-warn mcard-tight">
          <strong>Fixes that use what you already have</strong>
          <ul className="mlist jm-fixes">{m.fixes.map((f) => <li key={f}><Chip tone="warn">Fix</Chip><span>{f}</span></li>)}</ul>
        </div>
      )}
      <div className="jm-cols">
        <div className="jm-col"><h3 className="jm-col-h">What the job asks for</h3><Items m={m} /></div>
        <div className="jm-col"><h3 className="jm-col-h">How the score adds up</h3><Breakdown m={m} /></div>
      </div>
      <SkillGap m={m} />
      <div className="stack g8">
        {acc.tailor ? <Tailor m={m} onScore={setTailored} /> : <PackOffer kind="tailor" acc={acc} onBought={onBought} why="Want a copy of your resume tailored to this job?" />}
        <JobCover m={m} acc={acc} onUsed={onBought} offer={<PackOffer kind="tailor" acc={acc} onBought={onBought} why="Come back tomorrow for another free letter, or" />} />
        <div className="mrow jm-next">
          <button type="button" className="btn btn-outline" data-testid="jm-save-app" disabled={!!saved} onClick={saveApp}>{saved ? 'Saved to My applications' : 'Save to My applications'}</button>
          <ShareWhatsApp job={{ role: m.title, company: m.company }} testid="jm-share-wa" />
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
  // /me/ats?match=<id> (a resume health alert, "Tailor it"): open that saved match
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('match');
    // item 8: the job post in the box and the page at the result (tried until the result is drawn)
    if (id) {
      getMatch(id).then((r) => {
        setM(r);
        if (r.post) setText(r.post);
        let n = 0;
        const go = () => { const el = document.querySelector('[data-testid="jm-result"]'); if (el) el.scrollIntoView({ block: 'start' }); else if ((n += 1) < 40) setTimeout(go, 50); };
        setTimeout(go, 0);
      }).catch(() => {});
    }
  }, []);
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
  if (!acc) return <Skel cards={1} lines={4} label="Loading job match" />;
  const left = acc.free.matchesLeft;
  return (
    <>
      <section className="mcard jm-form" aria-label="Match a job" data-testid="jm-form">
        <header className="mcard-h"><span className="mcard-ic violet" aria-hidden="true">⇄</span><span className="mcard-ht"><h2 className="mcard-title">Match a job</h2><span className="mcard-sub">Paste a job post. We score your resume for it and show what to fix.</span></span></header>
        <div className="field"><label htmlFor="jm-r" className="label">Resume</label>
          <select id="jm-r" className="input" value={rid} onChange={(e) => setRid(e.target.value)}>{me.resumes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
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
        <StickyBar label="Match">
          <button type="button" className="btn btn-signal" data-testid="jm-go" disabled={!!busy || !text.trim() || left === 0} onClick={run}>{busy === 'match' && <Spinner />}{busy === 'match' ? 'Reading the post…' : 'Match my resume'}</button>
          <span className="mitem-meta" data-testid="jm-left">{acc.tailor ? 'Unlimited matches with your Tailor pack' : left === 0 ? 'You’ve used today’s free matches' : `${left} of ${acc.free.matchesPerDay} free matches left today`}</span>
        </StickyBar>
        {!acc.tailor && left === 0 && <PackOffer kind="tailor" acc={acc} onBought={refresh} why="Come back tomorrow for more free matches, or" />}
      </section>
      {m && <Result key={m.id} m={m} acc={acc} onChange={setM} onBought={refresh} />}
      {hist.length > 0 ? (
        <section className="mcard" aria-label="Your job matches" data-testid="jm-history">
          <h2 className="mcard-title">Your job matches</h2>
          <ul className="mlist">
            {hist.map((h) => (
              <li key={h.id} className="mitem">
                <span className={`jm-mini jm-mini-${h.score >= 80 ? 'ok' : h.score >= 60 ? 'warn' : 'bad'}`} aria-hidden="true">{h.score}</span>
                <span className="mitem-main">
                  <button type="button" className="link-btn jm-hist-open" onClick={async () => { try { setM(await getMatch(h.id)); } catch (e) { toast(e.message); } }}>{h.title || 'Job'}{h.company ? ` · ${h.company}` : ''}</button>
                  <span className="mitem-meta">{h.score}/100 · {fmtDay(h.createdAt)}{h.tailoredResumeId ? ' · tailored' : ''}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : !m && <Empty compact shape="resume" title="No job matches yet">Paste a job post above to see your first match.</Empty>}
    </>
  );
}
