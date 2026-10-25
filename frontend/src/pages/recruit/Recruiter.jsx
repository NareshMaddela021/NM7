// The recruiter page (Nm7 for Organizations, Phase 3C): /r/:token — resumes an organization chose to share with a
// company, from members who allowed it. No account needed; noindex; the server sends no-store and re-checks every
// candidate on every request (someone who leaves or opts out disappears at once). View always; Download and one
// combined PDF only when the coordinator allowed them; "Interested" ticks show up for the coordinator as
// "Shortlisted by <Company>". PDFs are drawn in this browser by the same PDF maker members use, with a small footer:
// "Shared with <Company> via Nm7 · expires <date>". Resume link names (/r/<name>) still open the public resume page.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Dialog, Spinner, useToast } from '../../components/ui';
import { brandDesign, prepareBrand } from '../../lib/branding';
import { usePageMeta } from '../../lib/meta';
import { filterCandidates, isRecruiterToken, pdfName } from '../../lib/recruiter';
import { freshImport } from '../../lib/chunks';
import { API_BASE, ApiError } from '../../services/http';
import { PublicResume } from '../me/MeShare';
import ResumePreview from '../builder/ResumePreview';
import ErrorBoundary from '../../components/ErrorBoundary';
import { designOf } from '../builder/design';

/** /r/:slug — a recruiter link (long token) or a member's public resume link (a short name). */
export default function ShareRoute() {
  const { slug } = useParams();
  return isRecruiterToken(slug) ? <RecruiterPage token={slug} /> : <PublicResume />;
}

/** Like http(), plus the access code header (the code never goes in the address). */
async function rq(path, code, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(code ? { 'X-Access-Code': code } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'network', 'We can’t reach the server. Check your internet and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code || 'error', data?.error?.message || 'Something went wrong. Please try again.');
  return data;
}

async function pdfOf(item, stamp) {
  const { buildResumePdf } = await freshImport(() => import('../builder/resumePdf'));
  const brand = await prepareBrand(item.brand);
  return buildResumePdf({ data: item.data, design: brand ? brandDesign(brand, item.data) : designOf(item.data), brand, stamp });
}

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function Shell({ children }) {
  return (
    <>
      <header className="container-wide row between g8" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
        <Link to="/" className="display" style={{ fontSize: 20, textDecoration: 'none', color: 'inherit' }}>Nm<mark>7</mark></Link>
        <span className="xs muted">Shared securely via Nm7</span>
      </header>
      <main id="main" className="container-wide stack g16" style={{ padding: '24px 16px 64px' }}>{children}</main>
    </>
  );
}

function RecruiterPage({ token }) {
  const base = `/api/recruit/${encodeURIComponent(token)}`;
  const toast = useToast();
  const [code, setCode] = useState('');
  const [typed, setTyped] = useState('');
  const [st, setSt] = useState({ loading: true });
  const [q, setQ] = useState('');
  const [onlyInterested, setOnlyInterested] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [busy, setBusy] = useState('');
  const load = useCallback((c = code) => rq(base, c).then((data) => setSt({ data }), (error) => setSt({ error })), [base, code]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const d = st.data;
  usePageMeta({ title: d ? `Resumes shared with ${d.company}` : 'Shared resumes', description: 'Resumes shared with you via Nm7.', noindex: true });
  const shown = useMemo(() => filterCandidates(d?.candidates, { q, interestedOnly: onlyInterested }), [d, q, onlyInterested]);

  const interest = async (c) => {
    const next = !c.interested;
    setSt((s) => ({ data: { ...s.data, candidates: s.data.candidates.map((x) => (x.id === c.id ? { ...x, interested: next } : x)) } }));
    try { await rq(`${base}/candidates/${c.id}/interest`, code, { method: 'POST', body: { interested: next } }); } catch (e) { toast(e.message); load(); }
  };
  const download = async (ids, label) => {
    setBusy(label);
    try {
      const r = await rq(`${base}/downloads`, code, { method: 'POST', body: { ids } });
      if (r.items.length === 1) save(await pdfOf(r.items[0], r.stamp), pdfName(r.items[0].name));
      else {
        const files = [];
        for (const item of r.items) files.push(await pdfOf(item, r.stamp));
        const { mergePdfs } = await freshImport(() => import('../../lib/orgExport'));
        const { bytes } = await mergePdfs(files);
        save(new Blob([bytes], { type: 'application/pdf' }), `${d.company.replace(/[^\p{L}\p{N}]+/gu, '_')}_resumes.pdf`);
      }
      toast('PDF ready');
    } catch (e) { toast(e.message); if (e.status === 404 || e.status === 410) load(); } finally { setBusy(''); }
  };

  if (st.loading) return <Shell><div className="row g12 muted" role="status"><Spinner /> Loading…</div></Shell>;
  if (st.error?.code === 'code_required' || st.error?.code === 'wrong_code') {
    return (
      <Shell>
        <form className="card stack g12" style={{ maxWidth: 420 }} onSubmit={(e) => { e.preventDefault(); setCode(typed); setSt({ loading: true }); load(typed); }}>
          <h1 className="display" style={{ fontSize: 26 }}>Enter the access code</h1>
          <p className="small muted">The organization gave you a 6-digit code with this link.</p>
          <div className="field"><label className="label" htmlFor="rc-code">Access code</label><input id="rc-code" className="input mono" inputMode="numeric" maxLength={6} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, ''))} /></div>
          {st.error.code === 'wrong_code' && <p className="error" role="alert">{st.error.message}</p>}
          <button type="submit" className="btn btn-ink" disabled={typed.length !== 6}>Open</button>
        </form>
      </Shell>
    );
  }
  if (st.error) {
    const ended = st.error.status === 410 || st.error.status === 404;
    return (
      <Shell>
        <div className="card stack g8" role="alert" style={{ maxWidth: 560 }}>
          <h1 className="display" style={{ fontSize: 26 }}>{ended ? 'This link has expired' : 'Couldn’t open this link'}</h1>
          <p>{ended ? 'The organization that shared these resumes has ended this link, or it has run out. Ask them for a new one.' : st.error.message}</p>
        </div>
      </Shell>
    );
  }
  const exp = new Date(d.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <Shell>
      <div className="stack g4">
        <span className="xs muted">From {d.orgName}{d.label ? ` · ${d.label}` : ''} · link expires {exp}</span>
        <h1 className="display" style={{ fontSize: 28 }}>Resumes shared with {d.company}</h1>
        <span className="small muted">These candidates agreed to share their resume with recruiters. Tick <strong>Interested</strong> to let {d.orgName} know.{d.includeContact ? '' : ' Contact details are shared through the organization.'}</span>
      </div>
      <div className="row g12" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 240px' }}><label className="label" htmlFor="rc-q">Search</label><input id="rc-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, skill or answer" /></div>
        <label className="row g8 small" style={{ minHeight: 40 }}><input type="checkbox" checked={onlyInterested} onChange={(e) => setOnlyInterested(e.target.checked)} /> Interested only</label>
        {d.allowDownloads && d.candidates.length > 0 && <button type="button" className="btn btn-ink" disabled={!!busy} onClick={() => download(shown.map((c) => c.id), 'all')}>{busy === 'all' ? 'Preparing…' : `Download ${shown.length === d.candidates.length ? 'all' : shown.length} as one PDF`}</button>}
      </div>
      {d.candidates.length === 0 ? <div className="well small muted" style={{ textAlign: 'center', padding: 24 }}>No candidates on this link right now.</div> : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="table">
            <thead><tr><th>Candidate</th>{d.answerLabels.map((l) => <th key={l}>{l}</th>)}<th>Complete</th><th>Interested</th><th /></tr></thead>
            <tbody>{shown.map((c) => (
              <tr key={c.id} data-testid="candidate">
                <td className="small"><strong>{c.name}</strong>{c.headline && <div className="xs muted">{c.headline}</div>}{c.email && <div className="xs">{c.email}{c.phone ? ` · ${c.phone}` : ''}</div>}</td>
                {d.answerLabels.map((l) => <td key={l} className="small">{c.answers[l] || '—'}</td>)}
                <td className="small">{c.completeness}%</td>
                <td><label className="row g4 small"><input type="checkbox" checked={c.interested} onChange={() => interest(c)} aria-label={`Interested in ${c.name}`} /> Interested</label></td>
                <td><div className="row g8">
                  <button type="button" className="link-btn small" onClick={() => setViewing(c)}>View</button>
                  {d.allowDownloads && <button type="button" className="link-btn small" disabled={!!busy} onClick={() => download([c.id], c.id)}>{busy === c.id ? 'Preparing…' : 'Download'}</button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {viewing && <ViewOne base={base} code={code} c={viewing} onClose={() => setViewing(null)} />}
    </Shell>
  );
}

function ViewOne({ base, code, c, onClose }) {
  const [st, setSt] = useState({ loading: true });
  useEffect(() => { rq(`${base}/candidates/${c.id}`, code).then((data) => setSt({ data }), (error) => setSt({ error })); }, [base, code, c.id]);
  return (
    <Dialog showTitle wide title={c.name} onClose={onClose}>
      {st.loading ? <div className="row g12 muted" role="status"><Spinner /> Loading…</div>
        : st.error ? <p role="alert">{st.error.status === 404 ? 'This candidate is no longer on the link.' : st.error.message}</p>
          : <ErrorBoundary title="This resume couldn’t be shown." text="Something in it couldn’t be drawn. Try again, or ask the student to open and save it once."><ResumePreview data={st.data.data} design={st.data.brand ? brandDesign(st.data.brand, st.data.data) : designOf(st.data.data)} brand={st.data.brand} stamp={st.data.stamp} /></ErrorBoundary>}
    </Dialog>
  );
}

