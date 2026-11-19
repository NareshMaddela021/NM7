// A company's eligibility on a drive day: rules (CGPA min, active backlogs max, branch, passing year, 10th / 12th %
// optional — never personal attributes), the auto-built list with the reason a student isn't eligible, exceptions
// with a note, the "verified" tick for self-declared marks, and one click to share the list with a recruiter invite.
import { useEffect, useState } from 'react';
import { Dialog, Spinner, useToast } from '../../components/ui';
import { http, useAction } from '../admin/live/common';
import '../../styles/me-kit.css';
import '../../styles/org-dashboard.css';
import { IcScale } from '../../components/icons';

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
  const field = (k, label, hint) => <label className="field pld-el-field"><span className="label">{label}</span><input className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} disabled={!canManage} placeholder={hint} data-testid={`el-${k}`} /></label>;
  return (
    <Dialog showTitle wide title={`Eligibility · ${company.name}`} onClose={onClose}>
      {!x ? <div className="row g8"><Spinner /> Loading…</div> : (
        <div className="stack g16 pld-el" data-testid="eligibility">
          <form className="pld-el-rules" onSubmit={save} aria-label="Rules">
            <span className="pld-card-h"><span className="pld-card-ic" aria-hidden="true"><IcScale /></span><span className="stack g4"><strong className="pld-card-title">Rules</strong><span className="xs muted">Rules on marks only. Leave a box empty for no rule. Students fill in their own marks under My groups; you can tick them verified.</span></span></span>
            <div className="pld-el-grid">
              {field('cgpaMin', 'CGPA at least', 'e.g. 7')}{field('backlogsMax', 'Active backlogs at most', 'e.g. 0')}{field('branches', 'Branches (comma)', 'CSE, ECE')}{field('years', 'Passing years', '2026')}{field('tenthMin', '10th % at least')}{field('twelfthMin', '12th % at least')}
            </div>
            {canManage && <button type="submit" className="btn btn-signal" disabled={busy} style={{ alignSelf: 'flex-start' }} data-testid="el-save">Save rules</button>}
          </form>
          <div className="pld-el-sum">
            <span className="stack g4" style={{ flex: '1 1 200px', minWidth: 0 }}>
              <strong className="pld-el-count" data-testid="el-count">{x.counts.eligible} of {x.counts.total} eligible</strong>
              <span className="pld-mini" aria-hidden="true"><span style={{ width: `${x.counts.total ? (100 * x.counts.eligible) / x.counts.total : 0}%` }} /></span>
            </span>
            <span className="pld-seg" role="group" aria-label="Show">
              {[['all', 'All'], ['yes', 'Eligible'], ['no', 'Not eligible']].map(([k, l]) => <button key={k} type="button" className={`pld-seg-btn ${show === k ? 'on' : ''}`} aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>)}
            </span>
          </div>
          <ul className="pld-el-list">
            {rows.map((r) => (
              <li key={r.id} className={`pld-el-row ${r.eligible ? 'yes' : 'no'}`} data-testid="el-row" data-eligible={r.eligible ? 'yes' : 'no'}>
                <span className="pld-el-top">
                  <span className="pld-av" aria-hidden="true">{(r.name || '?').trim().charAt(0).toUpperCase()}</span>
                  <span className="small pld-el-name">{r.roll ? <span className="mono">{r.roll} · </span> : null}{r.name} <span className="xs faint">{r.branch}</span></span>
                  <span className={`mchip ${r.eligible ? 'mchip-ok' : 'mchip-neutral'}`}>{r.eligible ? (r.exception ? 'Eligible (exception)' : 'Eligible') : 'Not eligible'}</span>
                </span>
                <span className="pld-el-marks">
                  <span>CGPA {r.academic.cgpa ?? '—'}</span><span>backlogs {r.academic.backlogs ?? '—'}</span><span>{r.academic.year ?? '—'}</span><span>10th {r.academic.tenth ?? '—'}</span><span>12th {r.academic.twelfth ?? '—'}</span><span className={r.academic.verified ? 'pld-ok' : ''}>{r.academic.verified ? 'verified' : 'self-declared'}</span>
                </span>
                {r.reasons.length > 0 && <span className="pld-el-why" data-testid="el-reasons">{r.reasons.join(' · ')}</span>}
                {r.exception && <span className="xs pld-el-exc">Exception: {r.exception}</span>}
                {canManage && (
                  <span className="pld-el-act">
                    {r.academic.cgpa != null && <button type="button" className="btn btn-outline btn-sm pld-sm" onClick={() => verify(r, !r.academic.verified)}>{r.academic.verified ? 'Remove verified tick' : 'Mark verified'}</button>}
                    {r.exception ? <button type="button" className="btn btn-outline btn-sm pld-sm" onClick={() => unexcept(r)}>Remove exception</button>
                      : !r.eligible && <button type="button" className="btn btn-outline btn-sm pld-sm" onClick={() => except(r)} data-testid="el-except">Add exception</button>}
                  </span>
                )}
              </li>
            ))}
            {rows.length === 0 && <li className="small muted pld-el-none">No students in this list.</li>}
          </ul>
          {canManage && x.invites.length > 0 && (
            <div className="pld-el-share">
              <label className="field" style={{ flex: '1 1 220px', minWidth: 0 }}><span className="label">Share the eligible list with</span><select className="input" value={inv} onChange={(e) => setInv(e.target.value)} data-testid="el-invite">{x.invites.map((i) => <option key={i.id} value={i.id}>{i.company}{i.shared ? ' (shared)' : ''}</option>)}</select></label>
              <button type="button" className="btn btn-signal" disabled={busy || !inv} onClick={share} data-testid="el-share">Share</button>
              <span className="xs muted" style={{ flexBasis: '100%' }}>The recruiter then sees only eligible students who allowed recruiter sharing.</span>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
