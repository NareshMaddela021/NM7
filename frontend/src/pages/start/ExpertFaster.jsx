// The expert quick start's "Fill your profile faster": a LinkedIn PDF (or a resume) fills the expert application's
// empty parts with the same reader as the application page (lib/expert.js fromDocument): only what is still empty
// is filled, nothing typed is changed. Loaded only on that step.
import { useEffect, useState } from 'react';
import { Spinner } from '../../components/ui';
import { BLANK, fromDocument, loadExpert, reloadExpert, saveExpert, useExpertReady } from '../../lib/expert';

export default function ExpertFaster({ onAdded }) {
  useEffect(() => { reloadExpert(); }, []); // the quick start saved the expertise on the server: read it again
  const ready = useExpertReady();
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  if (!ready) return <div className="row g8 muted" aria-busy="true"><Spinner />Loading your application…</div>;
  const read = async (file, mode) => {
    if (!file) return;
    setBusy(mode); setMsg('');
    try {
      const { importResume } = await import('../../lib/import/index');
      const R = await importResume(file, mode, () => {});
      saveExpert(fromDocument(loadExpert() || structuredClone(BLANK), R));
      setMsg(`Read ${file.name}: ${R.data.exp.length} roles and ${R.data.certs.length} certifications added where your application was empty.`);
      onAdded?.();
    } catch (e) { setMsg(e?.code ? e.message : 'We couldn’t read that file. Try another copy, or skip for now.'); } finally { setBusy(''); }
  };
  return (
    <div className="stack g12" data-testid="qs-expert-faster">
      {[['linkedin', 'Upload my LinkedIn PDF'], ['resume', 'Upload my resume (PDF or Word)']].map(([mode, label]) => (
        <label key={mode} className="btn btn-outline btn-lg qs-file" style={{ cursor: 'pointer' }}>
          {busy === mode && <Spinner />}{label}
          <input type="file" accept=".pdf,.docx,application/pdf" className="sr-only" aria-label={label} disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; read(f, mode); }} />
        </label>
      ))}
      <span className="xs muted">On LinkedIn: your profile → More → Save to PDF.</span>
      {msg && <p className="small" role="status" style={{ margin: 0 }}>{msg}</p>}
    </div>
  );
}
