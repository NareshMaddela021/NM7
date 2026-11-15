// /college-group/:id — a college group's owner: roll-up numbers by campus (joined, ready, placed, packages — never a
// student's details), one college format for every campus, and sharing a drive day or a recruiter invite.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Header from '../../components/Header';
import { Spinner, useToast } from '../../components/ui';
import { http } from '../../services/http';
import { Still } from '../newhome/ParticleStage';
import '../../styles/me-kit.css';
import '../../styles/org-groups.css';

const lpa = (v) => (v == null ? '—' : `${v} LPA`);

export default function CollegeGroup() {
  const { id } = useParams();
  const toast = useToast();
  const base = `/api/college-group/${encodeURIComponent(id)}`;
  const [d, setD] = useState(null);
  const [items, setItems] = useState([]);
  const [err, setErr] = useState('');
  const [fmt, setFmt] = useState('');
  const [share, setShare] = useState({ kind: 'drive', from: '', item: '', to: [] });
  useEffect(() => {
    http(base).then(setD, (e) => setErr(e.status === 404 ? 'You don’t run this college group, or it isn’t on the Campus plan.' : e.message));
    http(`${base}/items`).then(setItems, () => {});
  }, [base]);
  const from = items.find((c) => c.id === share.from);
  const doShare = async (e) => {
    e.preventDefault();
    try {
      const r = share.kind === 'drive'
        ? await http(`${base}/share-drive`, { method: 'POST', body: { orgId: share.from, driveId: share.item, toOrgIds: share.to } })
        : await http(`${base}/share-invite`, { method: 'POST', body: { orgId: share.from, inviteId: share.item, toOrgIds: share.to } });
      toast(`Copied to ${r.copied} campus${r.copied === 1 ? '' : 'es'}`);
    } catch (x) { toast(x.message); }
  };
  const doFormat = async () => { try { const r = await http(`${base}/format`, { method: 'PUT', body: { fromOrgId: fmt } }); toast(`College format applied to ${r.updated} campus${r.updated === 1 ? '' : 'es'}`); } catch (x) { toast(x.message); } };
  return (
    <>
      <Header variant="me" />
      <main id="main" className="container-wide stack g20" style={{ padding: '24px 16px 72px' }}>
        {err ? <div className="mcard mcard-bad" role="alert">{err}</div> : !d ? <div className="row g8"><Spinner /> Loading…</div> : (
          <div className="og-cg stack g20">
            <div className="mcard og-cg-hero">
              <span className="og-avatar og-avatar-lg" aria-hidden="true">{(d.name || '?').trim().charAt(0).toUpperCase()}</span>
              <div className="stack g4" style={{ minWidth: 0 }}><span className="xs muted">College group · numbers only — each campus’s coordinators manage their own students</span><h1 className="display og-cg-name">{d.name}</h1><span className="mchip mchip-accent" style={{ alignSelf: 'flex-start' }}>{d.campuses.length} campus{d.campuses.length === 1 ? '' : 'es'}</span></div>
              <span className="og-join-art" aria-hidden="true"><Still shape="college" tint="college" className="og-head-still" /></span>
            </div>
            <div className="og-tiles og-tiles-7" data-testid="cg-total">
              {[['Joined', d.total.joined], ['Ready', d.total.ready], ['Placed', d.total.placed], ['Offers', d.total.offers], ['Highest', lpa(d.total.highest)], ['Median', lpa(d.total.median)], ['Average', lpa(d.total.average)]].map(([l, v]) => (
                <div key={l} className="og-tile"><span className="og-tile-l">{l}</span><strong className="og-tile-v">{v}</strong></div>
              ))}
            </div>
            <section className="mcard og-cg-table">
              <header className="mcard-h"><span className="mcard-ic" aria-hidden="true">☷</span><span className="mcard-ht"><strong className="mcard-title">By campus</strong><span className="mcard-sub">Numbers only. Students’ details stay with each campus.</span></span></header>
              <div className="table-wrap og-table-wrap mtable-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table og-table mtable" aria-label="By campus" data-testid="cg-campuses"><thead><tr><th>Campus</th><th>Joined</th><th>Ready</th><th>Placed</th><th>Offers</th><th>Highest</th><th>Median</th><th>Average</th></tr></thead>
                <tbody>{d.campuses.map((c) => <tr key={c.id}><td className="small" data-label="Campus"><strong>{c.name}</strong></td><td className="small" data-label="Joined">{c.joined}</td><td className="small" data-label="Ready">{c.ready}</td><td className="small" data-label="Placed">{c.placed}</td><td className="small" data-label="Offers">{c.offers}</td><td className="small" data-label="Highest">{lpa(c.highest)}</td><td className="small" data-label="Median">{lpa(c.median)}</td><td className="small" data-label="Average">{lpa(c.average)}</td></tr>)}</tbody></table></div>
            </section>
            <div className="og-cg-cards">
            <section className="mcard og-cg-card" aria-label="College format">
              <header className="mcard-h"><span className="mcard-ic" aria-hidden="true">◧</span><span className="mcard-ht"><strong className="mcard-title">One college format for every campus</strong><span className="mcard-sub">Copies a campus’s logo, header, colours and placement-template rules to the others.</span></span></header>
              <div className="row g8" style={{ flexWrap: 'wrap' }}><select className="input" value={fmt} onChange={(e) => setFmt(e.target.value)} aria-label="Copy from" data-testid="cg-format-from"><option value="">Copy from…</option>{d.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button type="button" className="btn btn-signal" disabled={!fmt} onClick={doFormat} data-testid="cg-format">Apply to all campuses</button></div>
            </section>
            <form className="mcard og-cg-card" onSubmit={doShare} aria-label="Share with other campuses">
              <header className="mcard-h"><span className="mcard-ic" aria-hidden="true">⇄</span><span className="mcard-ht"><strong className="mcard-title">Share with other campuses</strong><span className="mcard-sub">A drive day’s schedule or a recruiter invite, copied to the campuses you pick.</span></span></header>
              <div className="row g8" style={{ flexWrap: 'wrap' }}>
                <select className="input" value={share.kind} onChange={(e) => setShare({ ...share, kind: e.target.value, item: '' })} aria-label="What"><option value="drive">A drive day’s schedule</option><option value="invite">A recruiter invite</option></select>
                <select className="input" value={share.from} onChange={(e) => setShare({ ...share, from: e.target.value, item: '', to: [] })} aria-label="From campus" data-testid="cg-share-from"><option value="">From campus…</option>{items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                {from && <select className="input" value={share.item} onChange={(e) => setShare({ ...share, item: e.target.value })} aria-label="Which" data-testid="cg-share-item"><option value="">Choose…</option>{(share.kind === 'drive' ? from.drives.map((x) => [x.id, `${x.name} · ${x.date}`]) : from.invites.map((x) => [x.id, x.company])).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
              </div>
              {from && <div className="row g12" style={{ flexWrap: 'wrap' }}>{items.filter((c) => c.id !== share.from).map((c) => <label key={c.id} className="og-pill-check small"><input type="checkbox" checked={share.to.includes(c.id)} onChange={(e) => setShare({ ...share, to: e.target.checked ? [...share.to, c.id] : share.to.filter((x) => x !== c.id) })} data-testid="cg-share-to" /> {c.name}</label>)}</div>}
              <span className="xs muted">Each campus gets its own copy: a drive day for its own students (its coordinators place them), or the recruiter invited with its own link.</span>
              <button type="submit" className="btn btn-signal" disabled={!share.item || !share.to.length} style={{ alignSelf: 'flex-start' }} data-testid="cg-share">Share</button>
            </form>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
