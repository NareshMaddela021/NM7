// The recruiter portal (colleges, Phase 3): /recruiter/:token. A recruiter a college invited signs in with a one-time
// code emailed to the invited address (no password; on colleges with recruiter accounts the same sign-in also opens
// My drives, and /recruiter/i.<invite id> opens an invite from there), then searches the students who allowed recruiter sharing in
// the groups they were given: skills (with synonyms), branch, CGPA, passing year, location, ATS score, internship,
// projects, certifications, languages. On Campus, job match mode scores every student against a pasted job post.
// The shortlist board (Shortlisted → Interview → Selected / Rejected, with notes) downloads as a ZIP or one combined
// PDF in the college's placement format (with its cover page), or as CSV. The server re-checks consent on every
// request, logs every view and download, rate-limits downloads and hides contact details unless allowed.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Dialog, Spinner, useToast } from '../../components/ui';
import { brandDesign, prepareBrand } from '../../lib/branding';
import { brandFor } from '../../lib/placementFormat';
import { usePageMeta } from '../../lib/meta';
import { freshImport } from '../../lib/chunks';
import { fileName, resumeFileName } from '../../lib/fileName';
import { STAGES, STAGE_LABEL, accountFromHash, boardColumns, cardLine, filterCount, isAccountPath, keepAccount, readAccount, searchQuery, sessionFromHash } from '../../lib/recruiterPortal';
import { API_BASE, ApiError } from '../../services/http';
import ResumePreview from '../builder/ResumePreview';
import ErrorBoundary from '../../components/ErrorBoundary';
import { designOf } from '../builder/design';
import SharedCerts from '../../components/SharedCerts';
import { openCertFile } from '../../lib/certs';
import Shell from './RecruiterShell';

const storeKey = (token) => `nm7-recruiter:${token.slice(0, 16)}`;
const readSession = (token) => { try { return sessionStorage.getItem(storeKey(token)) || ''; } catch { return ''; } };
const keepSession = (token, s) => { try { if (s) sessionStorage.setItem(storeKey(token), s); else sessionStorage.removeItem(storeKey(token)); } catch { /* private window: this tab only */ } };

async function rq(path, session, { method = 'GET', body, raw = false } = {}) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(session ? { 'X-Recruiter-Session': session } : {}), ...(readAccount() ? { 'X-Recruiter-Account': readAccount() } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'network', 'We can’t reach the server. Check your internet and try again.');
  }
  if (raw && res.ok) return res;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code || 'error', data?.error?.message || 'Something went wrong. Please try again.');
  return data;
}

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function RecruiterPortal() {
  const { token } = useParams();
  const base = `/api/recruiter/${encodeURIComponent(token)}`;
  const byAccount = isAccountPath(token);
  const [session, setSession] = useState(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const fromHash = sessionFromHash(hash);
    const account = accountFromHash(hash);
    if (account) keepAccount(account);
    if (fromHash) keepSession(token, fromHash);
    if (fromHash || account) window.history.replaceState(null, '', window.location.pathname);
    return fromHash || readSession(token);
  });
  const [info, setInfo] = useState({ loading: true });
  useEffect(() => { rq(base).then((data) => setInfo({ data }), (error) => setInfo({ error })); }, [base]);
  usePageMeta({ title: info.data ? `Students for ${info.data.company}` : 'Recruiter portal', description: 'Student resumes shared with you via Nm7.', noindex: true });
  const signOut = useCallback(() => { keepSession(token, ''); setSession(''); if (byAccount) { keepAccount(''); window.location.assign('/recruiter'); } }, [token, byAccount]);

  if (info.loading) return <Shell><div className="row g12 muted" role="status"><Spinner /> Loading…</div></Shell>;
  if (info.error) {
    const ended = info.error.status === 410 || info.error.status === 404;
    return (
      <Shell>
        <div className="card stack g8" role="alert" style={{ maxWidth: 560 }}>
          <h1 className="display" style={{ fontSize: 26 }}>{ended ? 'This invite has expired' : 'Couldn’t open this invite'}</h1>
          <p>{ended ? 'The college has ended this invite, or it has run out. Ask them for a new one.' : info.error.message}</p>
        </div>
      </Shell>
    );
  }
  if (byAccount && !readAccount()) {
    return (
      <Shell>
        <div className="card stack g8" style={{ maxWidth: 560 }}>
          <h1 className="display" style={{ fontSize: 26 }}>Sign in to open this drive</h1>
          <p className="small">Sign in with your email to see My drives.</p>
          <Link to="/recruiter" className="btn btn-ink" style={{ alignSelf: 'flex-start' }}>Recruiter sign-in</Link>
        </div>
      </Shell>
    );
  }
  if (!session && !byAccount) return <Shell><CodeGate base={base} info={info.data} onSession={(r) => { if (r.account) keepAccount(r.account); keepSession(token, r.session); setSession(r.session); }} /></Shell>;
  return <Shell><Workspace base={base} session={session} onSignedOut={signOut} /></Shell>;
}

function CodeGate({ base, info, onSession }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async () => {
    setBusy(true); setError('');
    try { await rq(`${base}/code`, '', { method: 'POST', body: {} }); setSent(true); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const verify = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { onSession(await rq(`${base}/session`, '', { method: 'POST', body: { code } })); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <form className="card stack g12" style={{ maxWidth: 460 }} onSubmit={verify} aria-label="Sign in">
      <span className="xs muted">{info.orgName} invited {info.recruiterName}</span>
      <h1 className="display" style={{ fontSize: 26 }}>Students for {info.company}</h1>
      <p className="small muted">For your security we email a one-time code to {info.emailHint}. No password needed.{info.accounts ? ' Signing in also opens My drives: every college that invited this email.' : ''}</p>
      {!sent ? <button type="button" className="btn btn-ink" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Email me a code'}</button> : (
        <>
          <div className="field"><label className="label" htmlFor="rp-code">Code from the email</label>
            <input id="rp-code" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
          <button type="submit" className="btn btn-ink" disabled={busy || code.length !== 6}>Sign in</button>
          <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={send}>Send a new code</button>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

const EMPTY = { skills: '', branch: '', cgpaMin: '', cgpaMax: '', year: '', location: '', atsMin: '', cert: '', language: '', q: '', internship: false, projects: false };

function Workspace({ base, session, onSignedOut }) {
  const toast = useToast();
  const [tab, setTab] = useState('search');
  const [filters, setFilters] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [st, setSt] = useState({ loading: true });
  const [match, setMatch] = useState(null);
  const [jd, setJd] = useState('');
  const [viewing, setViewing] = useState(null);
  const [busy, setBusy] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [picked, setPicked] = useState([]); // compare: 2–4 students (Campus)
  const [comparing, setComparing] = useState(null);
  const fail = useCallback((e) => { if (e.status === 401) { toast('Please sign in again.'); onSignedOut(); } else toast(e.message); }, [onSignedOut, toast]);
  const load = useCallback((f = applied) => rq(`${base}/candidates${searchQuery(f)}`, session).then((data) => setSt({ data }), (error) => { if (error.status === 401) onSignedOut(); else setSt({ error }); }), [base, session, applied, onSignedOut]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const d = st.data;
  const [board, setBoard] = useState(null);
  const loadBoard = useCallback(() => rq(`${base}/candidates?stage=`, session).then((data) => setBoard(data.candidates.filter((c) => c.stage !== 'none')), fail), [base, session, fail]);
  useEffect(() => { if (tab === 'board' || tab === 'interviews') loadBoard(); }, [tab, loadBoard]);
  const cols = useMemo(() => boardColumns(board || []), [board]);

  const apply = (e) => { e?.preventDefault(); setApplied(filters); setSt((s) => ({ ...s, loading: !s.data })); load(filters); setShowFilters(false); };
  const runMatch = async (e) => {
    e.preventDefault(); setBusy('match');
    try { setMatch(await rq(`${base}/match`, session, { method: 'POST', body: { jd } })); } catch (err) { fail(err); } finally { setBusy(''); }
  };
  const updateCard = (c) => {
    const put = (list) => list?.map((x) => (x.id === c.id ? { ...x, ...c, match: x.match, found: x.found, missing: x.missing } : x));
    setSt((s) => (s.data ? { data: { ...s.data, candidates: put(s.data.candidates) } } : s));
    setMatch((m) => (m ? { ...m, candidates: put(m.candidates) } : m));
    setBoard((b) => (b ? (c.stage === 'none' ? b.filter((x) => x.id !== c.id) : b.some((x) => x.id === c.id) ? put(b) : [...b, c]) : b));
    setViewing((v) => (v && v.id === c.id ? { ...v, ...c } : v));
  };
  const stage = async (c, next, note = c.note || '') => {
    try { updateCard(await rq(`${base}/board/${c.id}`, session, { method: 'PUT', body: { stage: next, note } })); } catch (e) { fail(e); }
  };

  const pick = (c, on) => setPicked((p) => (on ? (p.includes(c.id) || p.length >= 4 ? p : [...p, c.id]) : p.filter((x) => x !== c.id)));
  const runCompare = async () => {
    setBusy('compare');
    try {
      const r = await rq(`${base}/compare`, session, { method: 'POST', body: { ids: picked, jd: match && jd.trim().length >= 30 ? jd : null } });
      setComparing(r);
    } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const canPick = !!st.data?.compare;

  const download = async (kind) => {
    setBusy(kind);
    try {
      if (kind === 'csv') {
        const res = await rq(`${base}/board.csv`, session, { raw: true });
        save(await res.blob(), fileName([d.company, 'shortlist'], 'csv'));
        return;
      }
      const r = await rq(`${base}/downloads`, session, { method: 'POST', body: {} });
      const brands = Object.fromEntries(await Promise.all(Object.entries(r.brands || {}).map(async ([k, b]) => [k, await prepareBrand(b)])));
      const { buildResumePdf } = await freshImport(() => import('../builder/resumePdf'));
      const { collegeCoverPdf, mergePdfs, zipFiles } = await freshImport(() => import('../../lib/orgExport'));
      const bytes = async (b) => new Uint8Array(await b.arrayBuffer());
      const files = [];
      for (const item of r.items) {
        const brand = item.brand ? brandFor(brands[item.brand], item.roll) : null;
        const pdf = await buildResumePdf({ data: item.data, design: brand ? brandDesign(brand, item.data) : designOf(item.data), brand, stamp: r.stamp });
        files.push({ fileName: resumeFileName(item.name), bytes: await bytes(pdf) });
      }
      const college = r.cover?.brand && brands[r.cover.brand]?.collegeName ? brands[r.cover.brand] : null;
      const cover = college ? await bytes(collegeCoverPdf({ brand: college, batches: r.cover.batches, branches: r.cover.branches, count: files.length })) : null;
      const name = (ext) => fileName([d.company, 'shortlist'], ext);
      if (kind === 'zip') {
        save(new Blob([zipFiles(cover ? [{ fileName: '00_Cover.pdf', bytes: cover }, ...files] : files)], { type: 'application/zip' }), name('zip'));
      } else {
        const out = await mergePdfs(cover ? [cover, ...files.map((f) => f.bytes)] : files.map((f) => f.bytes));
        save(new Blob([out.bytes], { type: 'application/pdf' }), name('pdf'));
      }
      toast(kind === 'zip' ? 'ZIP ready' : 'PDF ready');
    } catch (e) { fail(e); } finally { setBusy(''); }
  };

  if (st.loading && !d) return <div className="row g12 muted" role="status"><Spinner /> Loading…</div>;
  if (st.error) return <div className="card" role="alert">{st.error.status === 410 ? 'This invite has expired. Ask the college for a new one.' : st.error.message}</div>;
  const exp = new Date(d.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const n = filterCount(applied);
  const list = tab === 'match' && match ? match.candidates : d.candidates;
  return (
    <>
      <div className="row between g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="stack g4">
          <span className="xs muted">From {d.orgName} · invite expires {exp}</span>
          <h1 className="display" style={{ fontSize: 28 }}>Students for {d.company}</h1>
          <span className="small muted">Only students who agreed to share their resume with recruiters are shown.{d.contact === 'hidden' ? ' Contact details go through the college.' : d.contact === 'after_shortlist' ? ' Contact details show once you shortlist a student.' : ''}</span>
        </div>
        <button type="button" className="link-btn small" onClick={onSignedOut}>Sign out</button>
      </div>
      <div className="segmented" role="tablist" aria-label="Views" style={{ display: 'flex', flexWrap: 'wrap' }}>
        {[['search', `Students (${d.total})`], ...(d.jobMatch ? [['match', 'Job match']] : []), ['board', 'Shortlist board'], ...(d.interviews ? [['interviews', 'Interviews']] : [])].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'search' && (
        <form className="stack g12" onSubmit={apply} aria-label="Search students">
          <div className="row g12" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '2 1 240px' }}><label className="label" htmlFor="rp-skills">Skills</label><input id="rp-skills" className="input" placeholder="e.g. Python, SQL, Power BI" value={filters.skills} onChange={(e) => setFilters({ ...filters, skills: e.target.value })} /></div>
            <div className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor="rp-branch">Branch</label>
              <select id="rp-branch" className="input" value={filters.branch} onChange={(e) => setFilters({ ...filters, branch: e.target.value })}><option value="">All</option>{d.branches.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
            <button type="button" className="btn btn-outline" aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>More filters{n ? ` (${n})` : ''}</button>
            <button type="submit" className="btn btn-ink">Search</button>
          </div>
          {showFilters && (
            <div className="row g12 well" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }} data-testid="more-filters">
              <div className="field" style={{ flex: '1 1 110px' }}><label className="label" htmlFor="rp-cmin">CGPA from</label><input id="rp-cmin" className="input" inputMode="decimal" value={filters.cgpaMin} onChange={(e) => setFilters({ ...filters, cgpaMin: e.target.value })} /></div>
              <div className="field" style={{ flex: '1 1 110px' }}><label className="label" htmlFor="rp-cmax">CGPA to</label><input id="rp-cmax" className="input" inputMode="decimal" value={filters.cgpaMax} onChange={(e) => setFilters({ ...filters, cgpaMax: e.target.value })} /></div>
              <div className="field" style={{ flex: '1 1 120px' }}><label className="label" htmlFor="rp-year">Passing year</label><input id="rp-year" className="input" inputMode="numeric" value={filters.year} onChange={(e) => setFilters({ ...filters, year: e.target.value })} /></div>
              <div className="field" style={{ flex: '1 1 150px' }}><label className="label" htmlFor="rp-loc">Location preference</label><input id="rp-loc" className="input" value={filters.location} onChange={(e) => setFilters({ ...filters, location: e.target.value })} /></div>
              <div className="field" style={{ flex: '1 1 120px' }}><label className="label" htmlFor="rp-ats">ATS score from</label><input id="rp-ats" className="input" inputMode="numeric" value={filters.atsMin} onChange={(e) => setFilters({ ...filters, atsMin: e.target.value })} /></div>
              <div className="field" style={{ flex: '1 1 150px' }}><label className="label" htmlFor="rp-cert">Certification</label><input id="rp-cert" className="input" value={filters.cert} onChange={(e) => setFilters({ ...filters, cert: e.target.value })} /></div>
              <div className="field" style={{ flex: '1 1 130px' }}><label className="label" htmlFor="rp-lang">Language</label><input id="rp-lang" className="input" value={filters.language} onChange={(e) => setFilters({ ...filters, language: e.target.value })} /></div>
              <label className="row g8 small" style={{ minHeight: 40 }}><input type="checkbox" checked={filters.internship} onChange={(e) => setFilters({ ...filters, internship: e.target.checked })} /> Has an internship</label>
              <label className="row g8 small" style={{ minHeight: 40 }}><input type="checkbox" checked={filters.projects} onChange={(e) => setFilters({ ...filters, projects: e.target.checked })} /> Has projects</label>
              <button type="button" className="link-btn small" onClick={() => { setFilters(EMPTY); setApplied(EMPTY); load(EMPTY); }}>Clear all</button>
            </div>
          )}
        </form>
      )}

      {tab === 'match' && (
        <form className="stack g8" onSubmit={runMatch} aria-label="Job match">
          <div className="field"><label className="label" htmlFor="rp-jd">Paste the job description</label>
            <textarea id="rp-jd" className="input" rows={6} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Title, must-have skills, nice-to-have skills…" /></div>
          <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy === 'match' || jd.trim().length < 30}>{busy === 'match' ? 'Scoring…' : 'Score every student'}</button>
          {match && <span className="small muted" data-testid="match-summary">{match.title ? `${match.title}: ` : ''}{match.candidates.length} students, best match first.{match.must?.length ? ` Must-have: ${match.must.join(', ')}.` : ''}</span>}
        </form>
      )}

      {tab !== 'board' && (list.length === 0
        ? <div className="well small muted" style={{ textAlign: 'center', padding: 24 }}>{tab === 'match' && !match ? 'Paste a job description to score the students.' : 'No students match. Try fewer filters.'}</div>
        : (tab === 'match' && !match) ? null : (
          <div className="grid" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))' }}>
            {list.map((c) => <Card key={c.id} c={c} onView={() => setViewing(c)} onStage={stage} pick={canPick ? { on: picked.includes(c.id), full: picked.length >= 4, set: (on) => pick(c, on) } : null} />)}
          </div>
        ))}

      {tab === 'board' && (
        <div className="stack g12">
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            {d.allowPdf && <button type="button" className="btn btn-ink" disabled={!!busy || !board?.length} onClick={() => download('zip')}>{busy === 'zip' ? 'Preparing…' : 'Download ZIP'}</button>}
            {d.allowPdf && <button type="button" className="btn btn-outline" disabled={!!busy || !board?.length} onClick={() => download('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'Combined PDF'}</button>}
            <button type="button" className="btn btn-outline" disabled={!!busy || !board?.length} onClick={() => download('csv')}>CSV</button>
          </div>
          {!board ? <div className="row g12 muted" role="status"><Spinner /> Loading…</div> : (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
              {STAGES.map((s) => (
                <section key={s} className="card stack g8" aria-label={STAGE_LABEL[s]} data-testid={`col-${s}`}>
                  <strong className="small">{STAGE_LABEL[s]} ({cols[s].length})</strong>
                  {cols[s].length === 0 && <span className="xs faint">Nobody yet.</span>}
                  {cols[s].map((c) => <BoardItem key={c.id} c={c} onStage={stage} onView={() => setViewing(c)} pick={canPick ? { on: picked.includes(c.id), full: picked.length >= 4, set: (on) => pick(c, on) } : null} />)}
                </section>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === 'interviews' && <Interviews base={base} session={session} board={board} onFail={fail} onChanged={loadBoard} />}
      {canPick && picked.length > 0 && (
        <div className="card row between g8" role="region" aria-label="Compare" style={{ position: 'sticky', bottom: 12, flexWrap: 'wrap', zIndex: 5 }}>
          <span className="small">{picked.length} picked{picked.length < 2 ? ' · pick at least 2' : picked.length >= 4 ? ' · 4 at most' : ''}</span>
          <div className="row g8">
            <button type="button" className="link-btn small" onClick={() => setPicked([])}>Clear</button>
            <button type="button" className="btn btn-ink" disabled={picked.length < 2 || busy === 'compare'} onClick={runCompare}>{busy === 'compare' ? 'Comparing…' : `Compare ${picked.length}`}</button>
          </div>
        </div>
      )}
      {comparing && <CompareView data={comparing} onClose={() => setComparing(null)} />}
      {viewing && <QuickView base={base} session={session} c={viewing} onClose={() => setViewing(null)} onStage={stage} onFail={fail} />}
    </>
  );
}

function StageSelect({ c, onStage, label }) {
  return (
    <select className="input" aria-label={label || `Stage for ${c.name}`} style={{ height: 34 }} value={c.stage} onChange={(e) => onStage(c, e.target.value)}>
      {['none', ...STAGES].map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
    </select>
  );
}

function PickBox({ c, pick }) {
  if (!pick) return null;
  return <label className="row g6 xs" style={{ minHeight: 32 }}><input type="checkbox" checked={pick.on} disabled={!pick.on && pick.full} onChange={(e) => pick.set(e.target.checked)} aria-label={`Compare ${c.name}`} /> Compare</label>;
}

function Card({ c, onView, onStage, pick }) {
  return (
    <article className="card stack g8" data-testid="student-card" aria-label={c.name}>
      <div className="row between g8" style={{ alignItems: 'flex-start' }}>
        <div className="stack g2" style={{ minWidth: 0 }}>
          <strong style={{ overflowWrap: 'anywhere' }}>{c.name}</strong>
          <span className="xs muted">{cardLine(c) || c.group}</span>
        </div>
        {c.match != null && <span className="badge b-success" data-testid="match-score" title="Job match score">{c.match}%</span>}
      </div>
      {c.skills.length > 0 && <div className="row g4" style={{ flexWrap: 'wrap' }}>{c.skills.slice(0, 6).map((s) => <span key={s} className="chip xs">{s}</span>)}</div>}
      {c.missing?.length > 0 && <span className="xs faint">Missing: {c.missing.join(', ')}</span>}
      <span className="xs faint">ATS {c.ats}{c.internship ? ' · internship' : ''}{c.projects ? ' · projects' : ''}</span>
      {c.email && <span className="xs" data-testid="contact">{c.email}{c.phone ? ` · ${c.phone}` : ''}</span>}
      <div className="row g8" style={{ alignItems: 'center' }}>
        <button type="button" className="btn btn-outline" onClick={onView}>Quick view</button>
        {c.stage === 'none'
          ? <button type="button" className="btn btn-ink" onClick={() => onStage(c, 'shortlisted')}>Shortlist</button>
          : <StageSelect c={c} onStage={onStage} />}
        <PickBox c={c} pick={pick} />
      </div>
    </article>
  );
}

function BoardItem({ c, onStage, onView, pick }) {
  const [note, setNote] = useState(c.note || '');
  useEffect(() => { setNote(c.note || ''); }, [c.note]);
  return (
    <div className="well stack g6" data-testid="board-item">
      <button type="button" className="link-btn small" style={{ textAlign: 'left' }} onClick={onView}><strong>{c.name}</strong></button>
      <span className="xs muted">{cardLine(c)}</span>
      <StageSelect c={c} onStage={onStage} />
      <PickBox c={c} pick={pick} />
      <input className="input xs" aria-label={`Note for ${c.name}`} placeholder="Note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => { if (note !== (c.note || '')) onStage(c, c.stage, note); }} />
    </div>
  );
}

const ROUND = { round: '', date: '', time: '10:00', minutes: 30, place: '', link: '', interviewer: '', notes: '' };
const STATUS_TONE = { confirmed: 'badge-success', reschedule: 'badge-warning', pending: '' };

/** Interview rounds (R3): schedule from the shortlist board; students get an email with a calendar file and answer. */
function Interviews({ base, session, board, onFail, onChanged }) {
  const toast = useToast();
  const [rounds, setRounds] = useState(null);
  const [form, setForm] = useState(null); // { ...ROUND, ids, editing? }
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => rq(`${base}/interviews`, session).then((r) => setRounds(r.rounds), onFail), [base, session, onFail]);
  useEffect(() => { load(); }, [load]);
  const people = (board || []).filter((c) => ['shortlisted', 'interview', 'selected'].includes(c.stage));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    const { editing, ids, ...round } = form;
    try {
      const r = editing
        ? await rq(`${base}/interviews/${editing}`, session, { method: 'PUT', body: { ...round, minutes: Number(round.minutes) } })
        : await rq(`${base}/interviews`, session, { method: 'POST', body: { ...round, minutes: Number(round.minutes), ids } });
      toast(editing ? `New time sent to ${r.emailsSent} student${r.emailsSent === 1 ? '' : 's'}` : `Invites sent to ${r.emailsSent} student${r.emailsSent === 1 ? '' : 's'}`);
      setForm(null); load(); onChanged();
    } catch (err) { onFail(err); } finally { setBusy(false); }
  };
  const cancel = async (rd) => {
    if (!window.confirm(`Cancel ${rd.round} on ${rd.when}? Students get an email.`)) return;
    try { await rq(`${base}/interviews/${rd.id}/cancel`, session, { method: 'POST', body: {} }); toast('Interview cancelled'); load(); } catch (e) { onFail(e); }
  };
  return (
    <div className="stack g12">
      <div className="row between g8" style={{ flexWrap: 'wrap' }}>
        <span className="small muted">Students get an email with a calendar file (Google Calendar, Outlook) and confirm or ask for another time. Times are in IST.</span>
        {!form && <button type="button" className="btn btn-ink" disabled={people.length === 0} onClick={() => setForm({ ...ROUND, ids: [] })}>Schedule an interview</button>}
      </div>
      {!form && people.length === 0 && <span className="xs faint">Shortlist students first: interviews are scheduled from the shortlist board.</span>}
      {form && (
        <form className="card stack g12" aria-label={form.editing ? 'Change the interview time' : 'Schedule an interview'} onSubmit={save}>
          <div className="row g12" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '2 1 200px' }}><label className="label" htmlFor="iv-round">Round name</label><input id="iv-round" className="input" required maxLength={60} placeholder="e.g. Technical round 1" value={form.round} onChange={(e) => set('round', e.target.value)} /></div>
            <div className="field" style={{ flex: '1 1 150px' }}><label className="label" htmlFor="iv-date">Date</label><input id="iv-date" type="date" className="input" required value={form.date} onChange={(e) => set('date', e.target.value)} /></div>
            <div className="field" style={{ flex: '1 1 110px' }}><label className="label" htmlFor="iv-time">Time (IST)</label><input id="iv-time" type="time" className="input" required value={form.time} onChange={(e) => set('time', e.target.value)} /></div>
            <div className="field" style={{ flex: '1 1 110px' }}><label className="label" htmlFor="iv-min">Duration</label>
              <select id="iv-min" className="input" value={form.minutes} onChange={(e) => set('minutes', e.target.value)}>{[15, 20, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}</select></div>
          </div>
          <div className="row g12" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor="iv-place">Place</label><input id="iv-place" className="input" maxLength={200} placeholder="e.g. Seminar hall, Block A" value={form.place} onChange={(e) => set('place', e.target.value)} /></div>
            <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor="iv-link">Online link</label><input id="iv-link" type="url" className="input" maxLength={500} placeholder="https://…" value={form.link} onChange={(e) => set('link', e.target.value)} /></div>
            <div className="field" style={{ flex: '1 1 180px' }}><label className="label" htmlFor="iv-who">Interviewer name</label><input id="iv-who" className="input" required maxLength={80} value={form.interviewer} onChange={(e) => set('interviewer', e.target.value)} /></div>
          </div>
          <div className="field"><label className="label" htmlFor="iv-notes">Notes for students (optional)</label><input id="iv-notes" className="input" maxLength={500} placeholder="e.g. Bring your college ID" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
          {!form.editing && (
            <fieldset className="stack g6" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">Students ({form.ids.length})</legend>
              {people.map((c) => (
                <label key={c.id} className="row g8 small"><input type="checkbox" checked={form.ids.includes(c.id)} onChange={(e) => set('ids', e.target.checked ? [...form.ids, c.id] : form.ids.filter((x) => x !== c.id))} /> {c.name} <span className="xs faint">· {STAGE_LABEL[c.stage]}</span></label>
              ))}
            </fieldset>
          )}
          {form.editing && <span className="xs faint">Every student on this round gets the new time and a new calendar file, and is asked to confirm again.</span>}
          <div className="row g8">
            <button type="submit" className="btn btn-ink" disabled={busy || (!form.editing && form.ids.length === 0) || (!form.place.trim() && !form.link.trim())}>{busy ? 'Sending…' : form.editing ? 'Send the new time' : 'Send invites'}</button>
            <button type="button" className="btn btn-outline" onClick={() => setForm(null)}>Back</button>
          </div>
        </form>
      )}
      {!rounds ? <div className="row g12 muted" role="status"><Spinner /> Loading…</div> : rounds.length === 0 ? <div className="well small muted">No interviews scheduled yet.</div> : rounds.map((rd) => (
        <article key={rd.id} className="card stack g8" data-testid="round" aria-label={rd.round}>
          <div className="row between g8" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div className="stack g2"><strong>{rd.round}</strong><span className="xs muted">{rd.when} · {rd.minutes} min · {[rd.place, rd.link].filter(Boolean).join(' · ')} · {rd.interviewer}</span></div>
            {rd.cancelled ? <span className="badge badge-warning">Cancelled</span> : <span className="xs" data-testid="round-counts">{rd.counts.confirmed} confirmed · {rd.counts.pending} waiting · {rd.counts.reschedule} asked for another time</span>}
          </div>
          <ul className="stack g4" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rd.students.map((s) => (
              <li key={s.id} className="row between g8 small" style={{ flexWrap: 'wrap' }} data-testid="round-student">
                <span>{s.name}{s.reason ? <span className="xs muted"> · “{s.reason}”</span> : null}</span>
                <span className={`badge ${STATUS_TONE[s.status]}`}>{s.statusName}</span>
              </li>
            ))}
          </ul>
          {!rd.cancelled && rd.startsAt > Date.now() && (
            <div className="row g8">
              <button type="button" className="btn btn-outline" onClick={() => setForm({ round: rd.round, date: rd.date, time: rd.time, minutes: rd.minutes, place: rd.place, link: rd.link, interviewer: rd.interviewer, notes: rd.notes, ids: [], editing: rd.id })}>Change time</button>
              <button type="button" className="link-btn small" onClick={() => cancel(rd)}>Cancel interview</button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

/** 2–4 students side by side: columns on a wide screen, stacked cards on a phone. */
function CompareView({ data, onClose }) {
  const rows = [
    ['Branch', (c) => c.branch || '—'],
    ['CGPA', (c) => (c.cgpa != null ? c.cgpa : c.percentage != null ? `${c.percentage}%` : '—')],
    ['Passing year', (c) => c.year || '—'],
    ['ATS score', (c) => c.ats],
    ...(data.must?.length ? [
      ['Job match', (c) => (c.match != null ? `${c.match}%` : '—')],
      ['Must-haves found', (c) => (c.mustFound?.length ? c.mustFound.join(', ') : 'None')],
      ['Must-haves missing', (c) => (c.mustMissing?.length ? c.mustMissing.join(', ') : 'None')],
    ] : []),
    ['Top skills', (c) => (c.skills.length ? c.skills.join(', ') : '—')],
    ['Projects', (c) => (c.projects.length ? <ul className="stack g4" style={{ margin: 0, paddingLeft: 16 }}>{c.projects.map((p, i) => <li key={i}><strong>{p.title}</strong>{p.tech ? ` · ${p.tech}` : ''}{p.line ? <div className="xs muted">{p.line}</div> : null}</li>)}</ul> : '—')],
    ['Internships', (c) => (c.internships.length ? <ul className="stack g4" style={{ margin: 0, paddingLeft: 16 }}>{c.internships.map((e, i) => <li key={i}>{[e.role, e.company].filter(Boolean).join(' · ')}{e.when ? <div className="xs muted">{e.when}</div> : null}</li>)}</ul> : '—')],
    ['Certificates', (c) => ([...c.certificates, ...c.walletCertificates.map((t) => `${t} (file shared)`)].join(', ') || '—')],
    ['Contact', (c) => (c.email ? `${c.email}${c.phone ? ` · ${c.phone}` : ''}` : 'Through the college')],
  ];
  return (
    <Dialog showTitle wide title={`Compare ${data.candidates.length} students`} onClose={onClose}>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 200px), 1fr))` }} data-testid="compare">
        {data.candidates.map((c) => (
          <article key={c.id} className="well stack g8" aria-label={c.name} data-testid="compare-card">
            <strong style={{ overflowWrap: 'anywhere' }}>{c.name}</strong>
            <dl className="stack g6 small" style={{ margin: 0 }}>
              {rows.map(([k, f]) => <div key={k} className="stack g2"><dt className="xs muted">{k}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{f(c)}</dd></div>)}
            </dl>
          </article>
        ))}
      </div>
    </Dialog>
  );
}

function QuickView({ base, session, c, onClose, onStage, onFail }) {
  const [st, setSt] = useState({ loading: true });
  useEffect(() => { rq(`${base}/candidates/${c.id}`, session).then((data) => setSt({ data }), (error) => { if (error.status === 401) onFail(error); setSt({ error }); }); }, [base, session, c.id, c.stage]); // eslint-disable-line react-hooks/exhaustive-deps
  const brand = st.data?.brand ? brandFor(st.data.brand, st.data.roll) : null;
  return (
    <Dialog showTitle wide title={c.name} onClose={onClose}>
      <div className="row g8" style={{ marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="small muted">{cardLine(c)}</span>
        <StageSelect c={c} onStage={onStage} label={`Stage for ${c.name} (quick view)`} />
      </div>
      {st.loading ? <div className="row g12 muted" role="status"><Spinner /> Loading…</div>
        : st.error ? <p role="alert">{st.error.status === 404 ? 'This student is no longer shared with you.' : st.error.message}</p>
          : <ErrorBoundary title="This resume couldn’t be shown." text="Something in it couldn’t be drawn. Try again, or ask the student to open and save it once."><ResumePreview data={st.data.data} design={brand ? brandDesign(brand, st.data.data) : designOf(st.data.data)} brand={brand} stamp={st.data.stamp} /></ErrorBoundary>}
      {st.data && <SharedCerts list={st.data.certificates} open={(x) => openCertFile(`${API_BASE}${base}/candidates/${c.id}/certificates/${x.id}`, { headers: { ...(session ? { 'X-Recruiter-Session': session } : {}), ...(readAccount() ? { 'X-Recruiter-Account': readAccount() } : {}) }, credentials: 'omit', name: x.title })} />}
    </Dialog>
  );
}
