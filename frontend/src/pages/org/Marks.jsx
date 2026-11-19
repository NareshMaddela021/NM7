// "My marks for placements" (self-declared): CGPA, active backlogs, passing year, 10th and 12th %. The college uses
// them for company eligibility and can tick "verified"; changing a number clears the tick.
import { useState } from 'react';
import { Spinner, useToast } from '../../components/ui';
import { http } from '../../services/http';
import '../../styles/me-kit.css';
import '../../styles/org-dashboard.css';
import { IcEdit } from '../../components/icons';

const FIELDS = [['cgpa', 'CGPA (out of 10)', '0.01', 0, 10], ['backlogs', 'Active backlogs', '1', 0, 60], ['year', 'Passing year', '1', 1990, 2100], ['tenth', '10th %', '0.01', 0, 100], ['twelfth', '12th / diploma %', '0.01', 0, 100]];
const blank = (a) => Object.fromEntries(FIELDS.map(([k]) => [k, a?.[k] ?? '']));

export default function Marks({ g }) {
  const toast = useToast();
  const [a, setA] = useState(g.academic);
  const [f, setF] = useState(blank(g.academic));
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = Object.fromEntries(FIELDS.map(([k, , step]) => [k, f[k] === '' ? null : (step === '1' ? parseInt(f[k], 10) : Number(f[k]))]));
      setA(await http(`/api/me/academic/${g.id}`, { method: 'PUT', body }));
      toast('Marks saved');
    } catch (x) { toast(x.message); } finally { setBusy(false); }
  };
  return (
    <form className="pld-marks" onSubmit={save} aria-label="My marks for placements" data-testid="marks">
      <span className="pld-marks-h">
        <span className="pld-card-ic" aria-hidden="true"><IcEdit /></span>
        <span className="stack g4" style={{ flex: 1, minWidth: 0 }}>
          <strong className="pld-card-title">My marks for placements</strong>
          <span className="xs muted">{g.orgName} uses these to check which companies you can apply to. Enter them as on your marks memo.</span>
        </span>
        {a?.verified ? <span className="mchip mchip-ok">Verified by {g.orgName}</span> : <span className="mchip mchip-neutral">Not verified yet</span>}
      </span>
      <div className="pld-marks-grid">
        {FIELDS.map(([k, label, step, min, max]) => (
          <label key={k} className="field pld-mark"><span className="label">{label}</span><input className="input" type="number" inputMode="decimal" step={step} min={min} max={max} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`marks-${k}`} /></label>
        ))}
      </div>
      <button type="submit" className="btn btn-signal" disabled={busy} style={{ alignSelf: 'flex-start' }} data-testid="marks-save">{busy && <Spinner />}Save marks</button>
    </form>
  );
}
