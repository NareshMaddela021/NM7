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
    <div className="stack g20">
      <MeHead title="Certificates" sub="Keep your course and internship certificates in one place. Add any of them to your resume in one tap." />
      <div className="well small" role="note" data-testid="cert-id-warning"><strong>{ID_WARNING}</strong> Certificates only — your files stay private unless you share them below.</div>
      {err && <p role="alert" className="error">{err}</p>}
      {!st ? <div className="row g8"><Spinner /> Loading…</div> : (
        <>
          <form className="card stack g12" onSubmit={upload} aria-label="Add a certificate" data-testid="cert-form">
            <strong>Add a certificate {st.items.length ? <span className="xs muted">({st.items.length} of {MAX_FILES})</span> : null}</strong>
            {full ? <span className="small muted">You have {MAX_FILES} certificates. Delete one to add another.</span> : (
              <>
                <div className="row g12" style={{ flexWrap: 'wrap' }}>
                  <label className="field" style={{ flex: '1 1 240px' }}><span className="label">Title *</span><input className="input" required minLength={2} maxLength={160} value={form.title} onChange={set('title')} placeholder="e.g. Python for Data Science" data-testid="cert-title" /></label>
                  <label className="field" style={{ flex: '1 1 180px' }}><span className="label">Issuer</span><input className="input" maxLength={120} value={form.issuer} onChange={set('issuer')} placeholder="e.g. NPTEL" data-testid="cert-issuer" /></label>
                  <label className="field" style={{ flex: '0 1 160px' }}><span className="label">Date</span><input className="input" type="month" value={form.date} onChange={set('date')} data-testid="cert-date" /></label>
                  <label className="field" style={{ flex: '1 1 240px' }}><span className="label">Credential link (optional)</span><input className="input" maxLength={400} value={form.link} onChange={set('link')} placeholder="https://…" data-testid="cert-link" /></label>
                </div>
                <label className="field"><span className="label">File (PDF, JPG or PNG, up to 2 MB)</span>
                  <input ref={pick} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => { setFile(e.target.files?.[0] || null); setErr(''); }} data-testid="cert-file" />
                </label>
                <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="cert-save">{busy && <Spinner />}Save certificate</button>
              </>
            )}
          </form>
          <section className="card stack g12" aria-label="Sharing">
            <label className="row g8 small" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" checked={st.share} onChange={(e) => sharing(e.target.checked)} data-testid="cert-share" style={{ marginTop: 3 }} />
              <span><strong>Share certificates</strong> with my college and the recruiters they invite (only the ones ticked below, and only where my resume is already shared). Off by default.</span>
            </label>
          </section>
          {st.items.length === 0 ? <p className="small muted">No certificates yet.</p> : (
            <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="My certificates">
              {st.items.map((c) => (
                <li key={c.id} className="card row g12" style={{ flexWrap: 'wrap', alignItems: 'center' }} data-testid="cert-item">
                  <span className="stack g4" style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <strong className="small">{c.title}</strong>
                    <span className="xs muted">{[c.issuer, c.date, kb(c.size)].filter(Boolean).join(' · ')}</span>
                    {c.link && <a className="xs" href={c.link} target="_blank" rel="noreferrer noopener">Credential link</a>}
                  </span>
                  <span className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                    <button type="button" className="btn btn-outline" style={{ minHeight: 36 }} onClick={() => openCertFile(`${API_BASE}/api/me/certificates/${c.id}/file`, { name: c.title }).catch((x) => toast(x.message))} data-testid="cert-view">View</button>
                    <button type="button" className="btn btn-outline" style={{ minHeight: 36 }} onClick={() => toResume(c)} data-testid="cert-to-resume">Add to resume</button>
                    <label className="xs row g4" title={st.share ? '' : 'Turn on Share certificates first'}><input type="checkbox" checked={c.share} onChange={(e) => patch(c.id, { share: e.target.checked })} data-testid="cert-pick" /> Share</label>
                    <button type="button" className="btn btn-icon" aria-label={`Delete ${c.title}`} onClick={() => remove(c)}>✕</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
