// Admin -> College groups: a parent group owning several campus organizations (Campus plan). Set its campuses, its
// owners (existing Nm7 accounts; they see roll-up numbers only) and, if agreed, a group price for billing.
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { PageHead } from '../AdminUI';
import { Chip } from '../../me/kit';
import { Loading, emptyIf, http, useAction, useApi } from './common';
import '../../../styles/me-kit.css';
import '../../../styles/admin-orgs.css';
import { IcCap } from '../../../components/icons';

function Edit({ g, orgs, onDone }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ name: g.name, orgIds: g.campuses.map((c) => c.id), ownerEmails: g.owners.map((o) => o.email).join(', '), groupPrice: g.groupPrice == null ? '' : g.groupPrice / 100, priceNote: g.priceNote });
  const save = (e) => {
    e.preventDefault();
    run(async () => { await http(`/api/admin/college-groups/${g.id}`, { method: 'PUT', body: { ...f, ownerEmails: f.ownerEmails.split(/[\s,;]+/).filter(Boolean), groupPrice: f.groupPrice === '' ? null : Math.round(Number(f.groupPrice) * 100) } }); onDone(); }, 'Saved');
  };
  return (
    <form className="mcard ao-card ao-cg-edit" onSubmit={save} aria-label={`College group ${g.name}`} data-testid="cg-edit">
      <header className="mcard-h"><span className="mcard-ic" aria-hidden="true"><IcCap /></span><span className="mcard-ht"><span className="mcard-title">{g.name}</span><span className="mcard-sub">{f.orgIds.length} campus{f.orgIds.length === 1 ? '' : 'es'} picked</span></span></header>
      <label className="small ao-lbl">Name <input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <fieldset className="ao-picker"><legend className="small ao-legend">Campuses</legend>
        <div className="ao-campuses">
          {orgs.map((o) => <label key={o.id} className={`ao-campus ${f.orgIds.includes(o.id) ? 'on' : ''}`}><input type="checkbox" checked={f.orgIds.includes(o.id)} onChange={(e) => setF({ ...f, orgIds: e.target.checked ? [...f.orgIds, o.id] : f.orgIds.filter((x) => x !== o.id) })} data-testid="cg-org" /> {o.name}<span className="xs faint ao-campus-plan">{o.plan?.name}</span></label>)}
        </div>
      </fieldset>
      <label className="small ao-lbl">Owners (emails of existing accounts) <input className="input" value={f.ownerEmails} onChange={(e) => setF({ ...f, ownerEmails: e.target.value })} data-testid="cg-owners" /></label>
      <div className="ao-fields">
        <label className="small ao-lbl">Group price per year (₹, optional) <input className="input" type="number" min="0" value={f.groupPrice} onChange={(e) => setF({ ...f, groupPrice: e.target.value })} /></label>
        <label className="small ao-lbl ao-span2">Price note <input className="input" maxLength={200} value={f.priceNote} onChange={(e) => setF({ ...f, priceNote: e.target.value })} /></label>
      </div>
      <span className="ao-note">Each campus keeps its own plan. A group price is recorded here; apply it to each campus as a custom plan in its Billing.</span>
      <button type="submit" className="btn btn-signal" disabled={busy} style={{ alignSelf: 'flex-start' }} data-testid="cg-save">Save</button>
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
      <form className="ad-toolbar ao-create" onSubmit={make}>
        <label className="small ao-lbl ao-grow">New college group <input className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} data-testid="cg-name" /></label>
        <button type="submit" className="btn btn-signal" disabled={busy} data-testid="cg-create">Create</button>
      </form>
      <Loading st={st} empty={emptyIf((x) => !x.length, 'No college groups yet.')}>{(rows) => (
        <div className="ao-cg-grid">
          {rows.map((g) => (open === g.id && orgs.data
            ? <Edit key={g.id} g={g} orgs={(orgs.data.items || orgs.data).filter((o) => !o.demo || g.campuses.some((c) => c.id === o.id))} onDone={() => { setOpen(null); st.reload(); }} />
            : (
              <button key={g.id} type="button" className="mcard ao-card ao-cg" onClick={() => setOpen(g.id)} data-testid="cg-item">
                <span className="ao-cg-top">
                  <span className="ao-av ao-av-lg" aria-hidden="true">{(g.name || '?').trim().charAt(0).toUpperCase()}</span>
                  <span className="ao-cg-txt"><strong className="ao-cg-name">{g.name}</strong><span className="xs muted">{g.campuses.map((c) => c.name).join(', ') || 'No campuses yet'} · owners: {g.owners.map((o) => o.email).join(', ') || 'none'}</span></span>
                </span>
                <span className="ao-cg-foot">
                  <Chip tone="accent">{g.campuses.length} campus{g.campuses.length === 1 ? '' : 'es'}</Chip>
                  <span className="small ao-cg-price">{g.groupPrice != null ? `₹${(g.groupPrice / 100).toLocaleString('en-IN')} / year` : 'Per-campus plans'}</span>
                </span>
              </button>
            )))}
        </div>
      )}</Loading>
    </div>
  );
}
