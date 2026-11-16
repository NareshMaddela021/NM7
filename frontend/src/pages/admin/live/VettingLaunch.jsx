// Admin → Skill checks → Launch: the vetting engine's one switch (site settings `vetting`). OFF (the default): only
// admins, demo accounts and the tester emails below see the new skill checks, badges and Hire now filters; everyone
// else sees the site exactly as before and gets no new emails. ON: everyone. Needs the "settings" permission (the
// owner); other admins see the state but cannot change it.
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { http, useAction, useApi } from './common';

export default function VettingLaunch() {
  const toast = useToast();
  const st = useApi('/api/admin/settings');
  const [busy, run] = useAction(toast);
  const [testers, setTesters] = useState('');
  const v = st.data?.vetting;
  useEffect(() => { if (v) setTesters((v.testers || []).join('\n')); }, [v]);
  if (st.error?.status === 403) return null; // not the owner: the switch is the owner's
  if (!v) return null;
  const list = () => testers.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const save = (pub) => run(async () => {
    await http('/api/admin/settings', { method: 'PUT', body: { vetting: { public: pub, testers: list() } } });
    st.reload();
  }, pub === v.public ? 'Testers saved' : pub ? 'Skill checks V2 is now live for everyone' : 'Hidden again: only admins, demo accounts and testers');
  return (
    <section className="card stack g12" aria-labelledby="vl-h" data-testid="vl-card">
      <div className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
        <h2 id="vl-h" className="h3" style={{ margin: 0 }}>Launch</h2>
        <span className={`mchip ${v.public ? 'mchip-ok' : 'mchip-warn'}`} role="status" data-testid="vl-state">{v.public ? 'Live for everyone' : 'Hidden: admins, demo accounts and testers only'}</span>
      </div>
      <p className="small" style={{ margin: 0 }}>
        {v.public
          ? 'Everyone gets the new skill checks, the “Skill verified” badge and the Hire now filters.'
          : 'Everyone else sees the site exactly as before (the old 10-question skill checks) and gets no new emails.'}
      </p>
      <label className="field stack g4">
        <span className="label">Testers (real accounts that see it while hidden; one email per line)</span>
        <textarea className="input" rows={3} value={testers} onChange={(e) => setTesters(e.target.value)} data-testid="vl-testers" style={{ minHeight: 88 }} />
      </label>
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={() => save(v.public)} data-testid="vl-save">Save testers</button>
        <button type="button" className={`btn ${v.public ? 'btn-outline' : 'btn-signal'}`} style={{ minHeight: 44 }} disabled={busy} onClick={() => save(!v.public)} data-testid="vl-toggle">
          {v.public ? 'Hide again' : 'Go live for everyone'}
        </button>
      </div>
    </section>
  );
}
