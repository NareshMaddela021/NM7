// Profile → Certificates: the certificate wallet. Upload a PDF / JPG / PNG (up to 10, 2 MB each after images are
// compressed here), with title, issuer, date and an optional credential link. One tap adds it to the resume's
// Certifications. "Share certificates" (off by default) lets the college staff and invited recruiters who already
// see the shared resume also open the certificates ticked here. Only the owner sees the files otherwise.
import { useEffect, useRef, useState } from 'react';
import { Spinner, useToast } from '../../components/ui';
import { activeResume, updateResume, useMe } from '../../lib/customerStore';
import { ID_WARNING, MAX_FILES, addToResume, compressImage, fileProblem, kb, openCertFile, toBase64 } from '../../lib/certs';
import { API_BASE, http } from '../../services/http';
import { MeHead } from './MeLayout';
import { Chip, Empty, Skel } from './kit';
import '../../styles/me-resume.css';

const blank = { title: '', issuer: '', date: '', link: '' };

export default function MeCertificates() {
  const toast = useToast();
  const me = useMe();
  const [st, setSt] = useState(null);
  const [form, setForm] = useState(blank);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pick = useRef(null);
  const load = () => http('/api/me/certificates').then(setSt, (e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const upload = async (e) => {
    e.preventDefault();
    const problem = fileProblem(file, form.title);
    if (problem) { setErr(problem); return; }
    setBusy(true); setErr('');
    try {
      const small = await compressImage(file);
      if (small.size > 2 * 1024 * 1024) throw new Error('That file is over 2 MB even after shrinking. Use a smaller scan.');
      await http('/api/me/certificates', { method: 'POST', body: { ...form, date: form.date || '', name: small.name, mime: small.type, data: await toBase64(small) } });
      setForm(blank); setFile(null); if (pick.current) pick.current.value = '';
      toast('Certificate saved');
      await load();
    } catch (x) { setErr(x.message || 'Couldn’t save it. Please try again.'); } finally { setBusy(false); }
  };
  const patch = async (id, body) => { try { await http(`/api/me/certificates/${id}`, { method: 'PATCH', body }); await load(); } catch (x) { toast(x.message); } };
  const remove = async (c) => {
    if (!window.confirm(`Delete “${c.title}”?`)) return;
    try { await http(`/api/me/certificates/${c.id}`, { method: 'DELETE' }); toast('Deleted'); await load(); } catch (x) { toast(x.message); }
  };
  const sharing = async (on) => { try { await http('/api/me/certificates/sharing', { method: 'PUT', body: { on } }); await load(); } catch (x) { toast(x.message); } };
  const toResume = (c) => {
    const r = activeResume(me);
    if (!r) { toast('Make a resume first'); return; }
    const { data, added } = addToResume(r.data, c);
    if (!added) { toast('It’s already on your resume'); return; }
    updateResume(r.id, { data });
    toast(`Added to “${r.name}” → Certifications`);
  };
  const full = st && st.items.length >= MAX_FILES;
  return (
    <div className="mstack">
      <MeHead title="Certificates" sub="Keep your course and internship certificates in one place. Add any of them to your resume in one tap." />
      <div className="mcard mcard-warn mcard-tight ct-note" role="note" data-testid="cert-id-warning"><span aria-hidden="true" className="ct-note-ic">⚠</span><span><strong>{ID_WARNING}</strong> Certificates only — your files stay private unless you share them.</span></div>
      {err && <p role="alert" className="error">{err}</p>}
      {!st ? <Skel cards={3} lines={2} label="Loading…" /> : (
        <>
          <section aria-label="My certificates list" className="mstack" style={{ gap: 12 }}>
            <div className="mspread"><h2 className="mcard-title">Your certificates</h2>{st.items.length > 0 && <Chip tone="neutral">{st.items.length} of {MAX_FILES}</Chip>}</div>
            {st.items.length === 0 ? (
              <Empty shape="badge" title="No certificates yet" action={<a href="#cert-add" className="btn btn-outline" onClick={(e) => { e.preventDefault(); document.querySelector('[data-testid="cert-title"]')?.focus(); }}>Add your first certificate</a>}>
                Add a course, NPTEL or internship certificate. You can put it on your resume in one tap.
              </Empty>
            ) : (
              <ul className="mgrid ct-grid" aria-label="My certificates">
                {st.items.map((c) => (
                  <li key={c.id} className="mcard ct-card" data-testid="cert-item">
                    <span className="ct-ribbon" aria-hidden="true">✪</span>
                    <span className="mstack" style={{ gap: 4, minWidth: 0 }}>
                      <strong className="ct-title">{c.title}</strong>
                      <span className="mitem-meta">{[c.issuer, c.date, kb(c.size)].filter(Boolean).join(' · ')}</span>
                      {c.link && <a className="xs" href={c.link} target="_blank" rel="noreferrer noopener">Credential link</a>}
                    </span>
                    <span className="mrow" style={{ gap: 6 }}>{c.share && st.share ? <Chip tone="ok">Shared</Chip> : <Chip tone="neutral">Private</Chip>}</span>
                    <span className="ct-actions">
                      <button type="button" className="btn btn-signal" onClick={() => toResume(c)} data-testid="cert-to-resume">Add to resume</button>
                      <button type="button" className="btn btn-outline" onClick={() => openCertFile(`${API_BASE}/api/me/certificates/${c.id}/file`, { name: c.title }).catch((x) => toast(x.message))} data-testid="cert-view">View</button>
                    </span>
                    <span className="mspread ct-foot">
                      <label className="sh-check" title={st.share ? '' : 'Turn on Share certificates first'}><input type="checkbox" checked={c.share} onChange={(e) => patch(c.id, { share: e.target.checked })} data-testid="cert-pick" /> Share</label>
                      <button type="button" className="btn btn-icon" aria-label={`Delete ${c.title}`} onClick={() => remove(c)}>✕</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <div className="mgrid-2">
            <form id="cert-add" className="mcard" onSubmit={upload} aria-label="Add a certificate" data-testid="cert-form">
              <header className="mcard-h"><span className="mcard-ic" aria-hidden="true">+</span><span className="mcard-ht"><h2 className="mcard-title">Add a certificate {st.items.length ? <span className="xs muted">({st.items.length} of {MAX_FILES})</span> : null}</h2><span className="mcard-sub">PDF, JPG or PNG. We shrink big photos for you.</span></span></header>
              {full ? <span className="small muted">You have {MAX_FILES} certificates. Delete one to add another.</span> : (
                <>
                  <div className="mfields-body">
                    <label className="field full"><span className="label">Title *</span><input className="input" required minLength={2} maxLength={160} value={form.title} onChange={set('title')} placeholder="e.g. Python for Data Science" data-testid="cert-title" /></label>
                    <label className="field"><span className="label">Issuer</span><input className="input" maxLength={120} value={form.issuer} onChange={set('issuer')} placeholder="e.g. NPTEL" data-testid="cert-issuer" /></label>
                    <label className="field"><span className="label">Date</span><input className="input" type="month" value={form.date} onChange={set('date')} data-testid="cert-date" /></label>
                    <label className="field full"><span className="label">Credential link (optional)</span><input className="input" maxLength={400} value={form.link} onChange={set('link')} placeholder="https://…" data-testid="cert-link" /></label>
                    <label className="field full ct-file"><span className="label">File (PDF, JPG or PNG, up to 2 MB)</span>
                      <input ref={pick} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => { setFile(e.target.files?.[0] || null); setErr(''); }} data-testid="cert-file" />
                    </label>
                  </div>
                  <button type="submit" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="cert-save">{busy && <Spinner />}Save certificate</button>
                </>
              )}
            </form>
            <section className="mcard" aria-label="Sharing">
              <header className="mcard-h"><span className="mcard-ic teal" aria-hidden="true">⇄</span><span className="mcard-ht"><h2 className="mcard-title">Sharing</h2><span className="mcard-sub">{st.share ? 'On: your college can open the ticked ones.' : 'Off: only you can open your files.'}</span></span></header>
              <label className="sh-check" style={{ alignItems: 'flex-start' }}>
                <input type="checkbox" checked={st.share} onChange={(e) => sharing(e.target.checked)} data-testid="cert-share" style={{ marginTop: 3 }} />
                <span><strong>Share certificates</strong> with my college and the recruiters they invite (only the ones ticked on each card, and only where my resume is already shared). Off by default.</span>
              </label>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
