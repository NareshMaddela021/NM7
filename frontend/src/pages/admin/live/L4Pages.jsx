// Admin -> Skill checks -> "L4 checks" (Vetting V4, the Nm7 human check). From GET /api/admin/vetting/l4:
//   Requests   every company request: the person, the company, when it was asked, when it is due (24-hour SLA), the
//              status; past due shows in red with "past 24 h".
//   Reviewers  status, roles, calibration %, quality, checks done, senior; Activate (only after calibration) / Pause /
//              Make senior. PUT /api/admin/vetting/l4/reviewers/{id} {status, senior}.
//   Settings   price, reviewer payout and the payments switch: FREE and OFF by default ("No prices yet; nothing is
//              charged or paid"); only the owner can change them. PUT /api/admin/vetting/l4/settings.
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { l4Status, settingsOf } from '../../../lib/l4';
import { Loading, http, useAction, useApi, when } from './common';
import '../../../styles/vetting-l4.css';

const RV_STATUS = { active: ['Active', 'mchip-ok'], paused: ['Paused', 'mchip-warn'], calibrating: ['Calibrating', 'mchip-info'], approval: ['Passed calibration · to approve', 'mchip-accent'] };
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

export function L4Checks() {
  const st = useApi('/api/admin/vetting/l4');
  return (
    <section className="stack g16" aria-label="L4 checks">
      <div className="vi-explain" role="note">
        <strong>The Nm7 human check (L4).</strong> A company asks; the candidate books a 15-minute call with a reviewer and names a past
        manager or teacher. Verified = the reviewer passed them <strong>and</strong> a referee confirmed them. Answer every request within 24 hours.
      </div>
      <Loading st={st}>{(d) => (
        <div className="stack g16">
          <Requests rows={d.requests || []} sla={d.sla} />
          <Reviewers rows={d.reviewers || []} onDone={st.reload} />
          <Settings s={settingsOf(d.settings)} onDone={st.reload} />
        </div>
      )}</Loading>
    </section>
  );
}

function Requests({ rows, sla }) {
  return (
    <div className="card stack g8" data-testid="l4-requests">
      <div className="row g8" style={{ flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <h2 className="vr-title">Requests</h2>
        <span className={`mchip ${sla?.overdue ? 'mchip-bad' : 'mchip-ok'}`} data-testid="l4-sla">{sla?.hours ?? 24} h SLA · {sla?.overdue || 0} overdue</span>
      </div>
      {rows.length === 0 ? <div className="well small muted vt-empty">No requests yet. They appear when a company taps “Request Nm7 check”.</div> : (
        <div className="table-wrap mtable-wrap vt-scroll">
          <table className="table mtable vt-table">
            <thead><tr><th scope="col">Person</th><th scope="col">Company</th><th scope="col">Requested</th><th scope="col">Due</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const [words, tone] = l4Status(r.status);
                return (
                  <tr key={r.id} className={r.overdue ? 'l4-overdue-row' : ''} data-testid="l4-req" data-overdue={r.overdue ? 'true' : undefined}>
                    <td><strong>{r.person || 'Unnamed'}</strong>{r.referees?.length > 0 && <span className="xs muted" style={{ display: 'block' }}>{r.referees.filter((x) => x.answered).length}/{r.referees.length} referees answered{r.referees.some((x) => x.flags?.length) ? ' · flagged' : ''}</span>}</td>
                    <td className="small" data-label="Company">{r.company}</td>
                    <td className="small" data-label="Requested">{when(r.requestedAt)}</td>
                    <td className="small" data-label="Due">{when(r.dueAt)}{r.overdue && <span className="l4-overdue" style={{ display: 'block' }} data-testid="l4-overdue">Overdue · past 24 h</span>}</td>
                    <td data-label="Status"><span className={`mchip mchip-${tone}`}>{words}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Reviewers({ rows, onDone }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const set = (r, status, senior) => run(async () => { await http(`/api/admin/vetting/l4/reviewers/${encodeURIComponent(r.id)}`, { method: 'PUT', body: { status, senior } }); onDone(); }, 'Saved');
  return (
    <div className="card stack g8" data-testid="l4-reviewers">
      <h2 className="vr-title">Reviewers</h2>
      <p className="small muted" style={{ margin: 0 }}>Experts apply from their Reviewer workspace and grade 5 sample interviews. Turn them on once calibration is 80% or more. 10% of checks go to a senior for a second opinion; reviewers who often disagree are paused.</p>
      {rows.length === 0 ? <div className="well small muted vt-empty">No reviewers yet.</div> : (
        <div className="table-wrap mtable-wrap vt-scroll">
          <table className="table mtable vt-table">
            <thead><tr><th scope="col">Reviewer</th><th scope="col">Status</th><th scope="col">Roles</th><th scope="col">Calibration</th><th scope="col">Quality</th><th scope="col">Done</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const [words, tone] = RV_STATUS[r.status] || [r.status, 'mchip-neutral'];
                const calOk = (r.calibration ?? 0) >= 0.8;
                return (
                  <tr key={r.id} data-testid="l4-rv">
                    <td><strong>{r.name || r.id}</strong>{r.senior && <span className="mchip mchip-accent" style={{ marginLeft: 6 }}>Senior</span>}<span className="xs muted" style={{ display: 'block' }}>{r.slots} weekly hours</span></td>
                    <td data-label="Status"><span className={`mchip ${tone}`}>{words}</span></td>
                    <td className="small" data-label="Roles">{r.roles.slice(0, 3).join(', ')}{r.roles.length > 3 ? ` +${r.roles.length - 3}` : ''}</td>
                    <td className="small" data-label="Calibration">{pct(r.calibration)}</td>
                    <td className="small" data-label="Quality">{r.quality ?? '—'}</td>
                    <td className="small" data-label="Checks done">{r.completed}</td>
                    <td>
                      <div className="l4-actions">
                        {r.status !== 'active' && <button type="button" className="btn btn-outline btn-sm" disabled={busy || !calOk} title={calOk ? undefined : 'Calibration not passed yet'} onClick={() => set(r, 'active', r.senior)} aria-label={`Activate ${r.name || 'reviewer'}`} data-testid="l4-activate">Activate</button>}
                        {r.status === 'active' && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => set(r, 'paused', r.senior)} aria-label={`Pause ${r.name || 'reviewer'}`} data-testid="l4-pause">Pause</button>}
                        <button type="button" className="btn btn-ghost btn-sm" disabled={busy || (!r.senior && r.status !== 'active')} onClick={() => set(r, r.status === 'approval' ? 'calibrating' : r.status, !r.senior)}
                          aria-label={`${r.senior ? 'Not senior' : 'Make senior'}: ${r.name || 'reviewer'}`} data-testid="l4-senior">{r.senior ? 'Not senior' : 'Make senior'}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Settings({ s, onDone }) {
  const toast = useToast();
  const owner = useAuth().user?.adminRole === 'owner';
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ price: String(s.priceInr), payout: String(s.payoutInr), on: s.paymentsOn });
  useEffect(() => { setF({ price: String(s.priceInr), payout: String(s.payoutInr), on: s.paymentsOn }); }, [s.priceInr, s.payoutInr, s.paymentsOn]);
  const free = !s.paymentsOn;
  const save = (e) => {
    e.preventDefault();
    const price = Number(f.price); const payout = Number(f.payout);
    if (![price, payout].every((n) => Number.isInteger(n) && n >= 0 && n <= 100000)) { toast('Price and payout are whole rupees from 0 to 1,00,000.'); return; }
    run(async () => { await http('/api/admin/vetting/l4/settings', { method: 'PUT', body: { priceInr: price, payoutInr: payout, paymentsOn: f.on } }); onDone(); }, 'Settings saved');
  };
  return (
    <form className="card stack g12" onSubmit={save} data-testid="l4-settings" aria-labelledby="l4-set-h">
      <div className="row g8" style={{ flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <h2 className="vr-title" id="l4-set-h">Price and payout</h2>
        <span className={`mchip ${free ? 'mchip-ok' : 'mchip-warn'}`} data-testid="l4-free">{free ? 'Free — payments off' : `₹${s.priceInr} per check · payout ₹${s.payoutInr}`}</span>
      </div>
      <p className="small" style={{ margin: 0 }} data-testid="l4-free-note">{free ? 'No prices yet; nothing is charged or paid.' : 'Payments are on: companies are charged the price and reviewers earn the payout per check.'}{owner ? '' : ' Only the owner can change this.'}</p>
      <fieldset className="l4-settings" disabled={!owner || busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <label className="field"><span className="label">Price per check (₹)</span>
          <input className="input" inputMode="numeric" value={f.price} onChange={(e) => setF((x) => ({ ...x, price: e.target.value.replace(/[^\d]/g, '') }))} data-testid="l4-price" /></label>
        <label className="field"><span className="label">Reviewer payout (₹)</span>
          <input className="input" inputMode="numeric" value={f.payout} onChange={(e) => setF((x) => ({ ...x, payout: e.target.value.replace(/[^\d]/g, '') }))} data-testid="l4-payout" /></label>
        <label className="l4-switch"><input type="checkbox" role="switch" checked={f.on} onChange={(e) => setF((x) => ({ ...x, on: e.target.checked }))} data-testid="l4-payments" />Payments on</label>
        <button type="submit" className="btn btn-signal vt-btn" data-testid="l4-save">Save</button>
      </fieldset>
    </form>
  );
}
