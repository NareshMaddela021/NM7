// A company's eligibility on a drive day: rules (CGPA min, active backlogs max, branch, passing year, 10th / 12th %
// optional — never personal attributes), the auto-built list with the reason a student isn't eligible, exceptions
// with a note, the "verified" tick for self-declared marks, and one click to share the list with a recruiter invite.
import { useEffect, useState } from 'react';
import { Dialog, Spinner, useToast } from '../../components/ui';
import { http, useAction } from '../admin/live/common';

const num = (v) => (v === '' || v == null ? null : Number(v));
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

export default function Eligibility({ dbase, company, canManage, onClose }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const base = `${dbase}/companies/${company.id}`;
  const [x, setX] = useState(null);
  const [f, setF] = useState(null);
  const [show, setShow] = useState('all');
  const [inv, setInv] = useState('');
  const take = (r) => { setX(r); setF({ cgpaMin: r.rules.cgpaMin ?? '', backlogsMax: r.rules.backlogsMax ?? '', branches: r.rules.branches.join(', '), years: r.rules.years.join(', '), tenthMin: r.rules.tenthMin ?? '', twelfthMin: r.rules.twelfthMin ?? '' }); setInv((v) => v || r.invites[0]?.id || ''); };
  useEffect(() => { http(`${base}/eligibility`).then(take, (e) => toast(e.message)); }, [base]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (e) => {
    e.preventDefault();
    run(async () => take(await http(`${base}/rules`, { method: 'PUT', body: { cgpaMin: num(f.cgpaMin), backlogsMax: num(f.backlogsMax), branches: list(f.branches), years: list(f.years).map(Number).filter(Boolean), tenthMin: num(f.tenthMin), twelfthMin: num(f.twelfthMin) } })), 'Rules saved');
  };
  const except = (r) => {
    const note = window.prompt(`Why include ${r.name} anyway? (shown in the Activity log)`);
    if (note && note.trim().length >= 3) run(async () => take(await http(`${base}/exceptions/${r.id}`, { method: 'PUT', body: { note } })), 'Exception added');
  };
  const unexcept = (r) => run(async () => take(await http(`${base}/exceptions/${r.id}`, { method: 'DELETE' })), 'Exception removed');
  const verify = (r, verified) => run(async () => { await http(`${dbase.split('/drives/')[0]}/academic/${r.id}/verify`, { method: 'PUT', body: { verified } }); take(await http(`${base}/eligibility`)); }, verified ? 'Marked verified' : 'Tick removed');
  const share = () => run(async () => { const s = await http(`${base}/share`, { method: 'POST', body: { inviteId: inv } }); toast(`Shared ${s.shared} eligible student${s.shared === 1 ? '' : 's'} with ${s.invite}${s.notOptedIn ? ` (${s.notOptedIn} didn’t allow recruiter sharing)` : ''}`); take(await http(`${base}/eligibility`)); });
  const rows = (x?.rows || []).filter((r) => show === 'all' || (show === 'yes' ? r.eligible : !r.eligible));
  const field = (k, label, w = 90) => <label className="small">{label}<input className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} style={{ width: w }} disabled={!canManage} data-testid={`el-${k}`} /></label>;
  return (
    <Dialog showTitle wide title={`Eligibility · ${company.name}`} onClose={onClose}>
      {!x ? <div className="row g8"><Spinner /> Loading…</div> : (
        <div className="stack g16" data-testid="eligibility">
          <form className="stack g8" onSubmit={save} aria-label="Rules">
            <span className="xs muted">Rules on marks only. Leave a box empty for no rule. Students fill in their own marks under My groups; you can tick them verified.</span>
            <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {field('cgpaMin', 'CGPA at least')}{field('backlogsMax', 'Active backlogs at most')}{field('branches', 'Branches (comma)', 140)}{field('years', 'Passing years', 110)}{field('tenthMin', '10th % at least')}{field('twelfthMin', '12th % at least')}
              {canManage && <button type="submit" className="btn btn-ink" disabled={busy} data-testid="el-save">Save rules</button>}
            </div>
          </form>
          <div className="row between g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <strong data-testid="el-count">{x.counts.eligible} of {x.counts.total} eligible</strong>
            <span className="row g8" role="group" aria-label="Show">
              {[['all', 'All'], ['yes', 'Eligible'], ['no', 'Not eligible']].map(([k, l]) => <button key={k} type="button" className={`btn ${show === k ? 'btn-ink' : 'btn-outline'}`} style={{ minHeight: 30 }} aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>)}
            </span>
          </div>
          <ul className="stack g4" style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: '45vh', overflow: 'auto' }}>
            {rows.map((r) => (
              <li key={r.id} className="stack g4" style={{ borderBottom: '1px solid var(--border)', padding: '6px 0' }} data-testid="el-row" data-eligible={r.eligible ? 'yes' : 'no'}>
                <span className="row between g8" style={{ flexWrap: 'wrap' }}>
                  <span className="small">{r.roll ? <span className="mono">{r.roll} · </span> : null}{r.name} <span className="xs faint">{r.branch}</span></span>
                  <span className={`badge ${r.eligible ? 'b-success' : 'b-neutral'}`}>{r.eligible ? (r.exception ? 'Eligible (exception)' : 'Eligible') : 'Not eligible'}</span>
                </span>
                <span className="xs muted">CGPA {r.academic.cgpa ?? '—'} · backlogs {r.academic.backlogs ?? '—'} · {r.academic.year ?? '—'} · 10th {r.academic.tenth ?? '—'} · 12th {r.academic.twelfth ?? '—'} · {r.academic.verified ? 'verified' : 'self-declared'}</span>
                {r.reasons.length > 0 && <span className="xs" data-testid="el-reasons">{r.reasons.join(' · ')}</span>}
                {r.exception && <span className="xs">Exception: {r.exception}</span>}
                {canManage && (
                  <span className="row g8" style={{ flexWrap: 'wrap' }}>
                    {r.academic.cgpa != null && <button type="button" className="link-btn xs" onClick={() => verify(r, !r.academic.verified)}>{r.academic.verified ? 'Remove verified tick' : 'Mark verified'}</button>}
                    {r.exception ? <button type="button" className="link-btn xs" onClick={() => unexcept(r)}>Remove exception</button>
                      : !r.eligible && <button type="button" className="link-btn xs" onClick={() => except(r)} data-testid="el-except">Add exception</button>}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {canManage && x.invites.length > 0 && (
            <div className="well row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="small">Share the eligible list with <select className="input" value={inv} onChange={(e) => setInv(e.target.value)} data-testid="el-invite">{x.invites.map((i) => <option key={i.id} value={i.id}>{i.company}{i.shared ? ' (shared)' : ''}</option>)}</select></label>
              <button type="button" className="btn btn-outline" disabled={busy || !inv} onClick={share} data-testid="el-share">Share</button>
              <span className="xs muted" style={{ flexBasis: '100%' }}>The recruiter then sees only eligible students who allowed recruiter sharing.</span>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
