// Admin → College groups: a parent group owning several campus organizations (Campus plan). Set its campuses, its
// owners (existing Nm7 accounts; they see roll-up numbers only) and, if agreed, a group price for billing.
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { PageHead } from '../AdminUI';
import { Loading, emptyIf, http, useAction, useApi } from './common';

function Edit({ g, orgs, onDone }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ name: g.name, orgIds: g.campuses.map((c) => c.id), ownerEmails: g.owners.map((o) => o.email).join(', '), groupPrice: g.groupPrice == null ? '' : g.groupPrice / 100, priceNote: g.priceNote });
  const save = (e) => {
    e.preventDefault();
    run(async () => { await http(`/api/admin/college-groups/${g.id}`, { method: 'PUT', body: { ...f, ownerEmails: f.ownerEmails.split(/[\s,;]+/).filter(Boolean), groupPrice: f.groupPrice === '' ? null : Math.round(Number(f.groupPrice) * 100) } }); onDone(); }, 'Saved');
  };
  return (
    <form className="card stack g12" onSubmit={save} aria-label={`College group ${g.name}`} data-testid="cg-edit">
      <label className="small">Name <input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }}><legend className="small">Campuses</legend>
        {orgs.map((o) => <label key={o.id} className="row g8 small"><input type="checkbox" checked={f.orgIds.includes(o.id)} onChange={(e) => setF({ ...f, orgIds: e.target.checked ? [...f.orgIds, o.id] : f.orgIds.filter((x) => x !== o.id) })} data-testid="cg-org" /> {o.name}<span className="xs faint">{o.plan?.name}</span></label>)}
      </fieldset>
      <label className="small">Owners (emails of existing accounts) <input className="input" value={f.ownerEmails} onChange={(e) => setF({ ...f, ownerEmails: e.target.value })} data-testid="cg-owners" /></label>
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <label className="small">Group price per year (₹, optional) <input className="input" type="number" min="0" value={f.groupPrice} onChange={(e) => setF({ ...f, groupPrice: e.target.value })} style={{ width: 160 }} /></label>
        <label className="small" style={{ flex: '1 1 220px' }}>Price note <input className="input" maxLength={200} value={f.priceNote} onChange={(e) => setF({ ...f, priceNote: e.target.value })} /></label>
      </div>
      <span className="xs muted">Each campus keeps its own plan. A group price is recorded here; apply it to each campus as a custom plan in its Billing.</span>
      <button type="submit" className="btn btn-ink" disabled={busy} style={{ alignSelf: 'flex-start' }} data-testid="cg-save">Save</button>
    </form>
  );
}

export function LiveCollegeGroups() {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const st = useApi('/api/admin/college-groups');
  const orgs = useApi('/api/admin/orgs');
  const [name, setName] = useState('');
  const [open, setOpen] = useState(null);
  const make = (e) => { e.preventDefault(); run(async () => { const g = await http('/api/admin/college-groups', { method: 'POST', body: { name } }); setName(''); st.reload(); setOpen(g.id); }, 'Group created'); };
  return (
    <div className="stack g16">
      <PageHead title="College groups" sub="One parent group over several campuses: roll-up dashboards for the group's owners; each campus keeps its own coordinators and data." />
      <form className="card row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={make}>
        <label className="small" style={{ flex: '1 1 240px' }}>New college group <input className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} data-testid="cg-name" /></label>
        <button type="submit" className="btn btn-ink" disabled={busy} data-testid="cg-create">Create</button>
      </form>
      <Loading st={st} empty={emptyIf((x) => !x.length, 'No college groups yet.')}>{(rows) => (
        <div className="stack g12">
          {rows.map((g) => (open === g.id && orgs.data
            ? <Edit key={g.id} g={g} orgs={(orgs.data.items || orgs.data).filter((o) => !o.demo || g.campuses.some((c) => c.id === o.id))} onDone={() => { setOpen(null); st.reload(); }} />
            : (
              <button key={g.id} type="button" className="card row between g8" style={{ textAlign: 'left', flexWrap: 'wrap' }} onClick={() => setOpen(g.id)} data-testid="cg-item">
                <span className="stack g4"><strong>{g.name}</strong><span className="xs muted">{g.campuses.map((c) => c.name).join(', ') || 'No campuses yet'} · owners: {g.owners.map((o) => o.email).join(', ') || 'none'}</span></span>
                <span className="small">{g.groupPrice != null ? `₹${(g.groupPrice / 100).toLocaleString('en-IN')} / year` : 'Per-campus plans'}</span>
              </button>
            )))}
        </div>
      )}</Loading>
    </div>
  );
}
