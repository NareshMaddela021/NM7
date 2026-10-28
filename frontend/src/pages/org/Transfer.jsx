// Transfer ownership. The Owner starts it from Team (to a coordinator or any email address; they choose whether
// they stay as a coordinator or leave); the new owner confirms at /org/transfer with the code we email them, signed
// in with that address. Nm7's admin can start one too (Admin > Organizations). Billing moves with the organization.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Spinner, useToast } from '../../components/ui';
import { http } from '../../services/http';
import { Loading, day, emptyIf, useAction, useApi } from '../admin/live/common';
import { MeHead } from '../me/MeLayout';

/** Org > Team: start, see and cancel a transfer (Owner). `base` is the transfer endpoint (Owner or admin). */
export function TransferOwnership({ base, team = [], admin = false }) {
  const toast = useToast();
  const st = useApi(base);
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ toEmail: '', oldOwner: 'coordinator' });
  const others = team.filter((s) => s.status === 'active' && s.role !== 'owner');
  return (
    <section className="card stack g12" aria-label="Transfer ownership" data-testid="transfer">
      <strong>Transfer ownership</strong>
      <span className="xs muted">{admin ? 'On the Owner’s request.' : 'Hand the organization to someone else.'} The new owner gets a code by email and confirms it signed in with that address. The plan, invoices and payment reminders move with the organization. Written to the Activity log.</span>
      <Loading st={st}>{(t) => (t ? (
        <div className="well stack g8" data-testid="transfer-pending">
          <span className="small">Waiting for <strong>{t.toEmail}</strong> to confirm (until {day(t.expiresAt)}). After that, {admin ? 'the old Owner' : 'you'} {t.oldOwner === 'leave' ? 'will leave the organization' : 'will stay as a coordinator'}.</span>
          <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start', minHeight: 36 }} disabled={busy} onClick={() => run(async () => { await http(base, { method: 'DELETE' }); st.reload(); }, 'Transfer cancelled')} data-testid="transfer-cancel">Cancel transfer</button>
        </div>
      ) : (
        <form className="stack g12" onSubmit={(e) => { e.preventDefault(); if (window.confirm(`Make ${f.toEmail} the Owner? They confirm with a code sent to that address.`)) run(async () => { await http(base, { method: 'POST', body: f }); st.reload(); }, 'Code sent to the new owner'); }}>
          <div className="field"><label className="label" htmlFor="tr-e">New owner’s email</label>
            <input id="tr-e" type="email" className="input" required list="tr-team" value={f.toEmail} onChange={(e) => setF({ ...f, toEmail: e.target.value })} data-testid="transfer-email" />
            <datalist id="tr-team">{others.map((s) => <option key={s.id} value={s.email}>{s.name || s.email}</option>)}</datalist>
            {others.length > 0 && <span className="xs muted">Pick one of your coordinators, or type any email address.</span>}
          </div>
          <fieldset className="stack g4" style={{ border: 0, padding: 0 }}>
            <legend className="label">{admin ? 'Then the old Owner' : 'Then you'}</legend>
            <label className="row g8 small"><input type="radio" name="tr-old" checked={f.oldOwner === 'coordinator'} onChange={() => setF({ ...f, oldOwner: 'coordinator' })} />{admin ? 'stays' : 'stay'} as a coordinator</label>
            <label className="row g8 small"><input type="radio" name="tr-old" checked={f.oldOwner === 'leave'} onChange={() => setF({ ...f, oldOwner: 'leave' })} data-testid="transfer-leave" />{admin ? 'leaves' : 'leave'} the organization</label>
          </fieldset>
          <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="transfer-start">Send code to the new owner</button>
        </form>
      ))}</Loading>
    </section>
  );
}

/** /org/transfer — the new owner enters the code. */
export default function AcceptTransfer() {
  const toast = useToast();
  const nav = useNavigate();
  const st = useApi('/api/me/org-transfers');
  const [code, setCode] = useState({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const accept = async (t) => {
    setBusy(t.id); setErr('');
    try {
      const r = await http(`/api/me/org-transfers/${t.id}/accept`, { method: 'POST', body: { code: code[t.id] || '' } });
      toast(`You’re now the Owner of ${t.orgName}`);
      nav(`/org/${r.orgId}`);
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  return (
    <main id="main" className="container stack g16" style={{ maxWidth: 640, padding: '32px 16px 64px' }}>
      <MeHead title="Become the Owner" sub="Enter the 6-digit code from the email we sent you." />
      <Loading st={st} empty={emptyIf((d) => !d.length, 'Nothing is waiting for this email address. Check you are signed in with the address the code was sent to.')}>{(rows) => rows.map((t) => (
        <form key={t.id} className="card stack g12" data-testid="accept-transfer" onSubmit={(e) => { e.preventDefault(); accept(t); }}>
          <strong>{t.orgName}</strong>
          <span className="small muted">{t.fromName || 'The Owner'} wants to make you the Owner. You’ll choose and pay for the plan, invite coordinators and run placement drives.</span>
          <div className="field" style={{ maxWidth: 220 }}><label className="label" htmlFor={`tc-${t.id}`}>Code</label>
            <input id={`tc-${t.id}`} className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code[t.id] || ''} onChange={(e) => setCode({ ...code, [t.id]: e.target.value.replace(/\D/g, '') })} data-testid="accept-code" /></div>
          {err && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{err}</span>}
          <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={!!busy || (code[t.id] || '').length !== 6} data-testid="accept-go">{busy === t.id && <Spinner />}Become the Owner</button>
        </form>
      ))}</Loading>
      <Link to="/org" className="small">← My organizations</Link>
    </main>
  );
}
