// Kiosk links for events (Phase 3A): create one per stall (group, label, expiry, exit PIN), see which kiosks are in
// use today, revoke at once. Used in the coordinator portal (/org/:orgId/kiosks) and the admin console. The server
// checks everything (feature switch, scope, role); viewers get the list without the buttons.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useToast } from '../../components/ui';
import { KIOSK_STATE, PIN_RE, expiryOptions } from '../../lib/kiosk';
import { downloadQrPng, qrFileName } from '../../lib/qr';
import { Loading, emptyIf, http, useAction, useApi, when } from '../admin/live/common';

const inputStyle = { height: 40 };
const tone = { active: 'b-success', idle: 'b-neutral', expired: 'b-neutral', revoked: 'b-warning' };

function Qr({ url }) {
  const [src, setSrc] = useState('');
  useEffect(() => { let off = false; QRCode.toDataURL(url, { width: 240, margin: 1 }).then((u) => !off && setSrc(u)); return () => { off = true; }; }, [url]);
  return src ? <img src={src} width={120} height={120} alt="QR code for the kiosk link" style={{ borderRadius: 8, border: '1px solid var(--border)' }} /> : null;
}

export default function Kiosks({ orgId, groups, canManage }) {
  const toast = useToast();
  const st = useApi(`/api/org/${encodeURIComponent(orgId)}/kiosks`);
  const [busy, run] = useAction(toast);
  const days = expiryOptions();
  const blank = { groupId: groups[0]?.id || '', label: '', expiresOn: days[0].value, pin: '' };
  const [f, setF] = useState(blank);
  const [made, setMade] = useState(null);
  const ok = f.groupId && f.label.trim() && PIN_RE.test(f.pin);
  const create = (e) => {
    e.preventDefault();
    run(async () => {
      const k = await http(`/api/org/${encodeURIComponent(orgId)}/kiosks`, { method: 'POST', body: { ...f, label: f.label.trim() } });
      setMade(k); setF({ ...blank, groupId: f.groupId }); st.reload();
    }, 'Kiosk link made');
  };
  const revoke = (k) => {
    if (!window.confirm(`Revoke “${k.label}”? The kiosk stops at once and anyone using it is signed out.`)) return;
    run(async () => { await http(`/api/org/${encodeURIComponent(orgId)}/kiosks/${k.id}/revoke`, { method: 'POST', body: {} }); st.reload(); }, 'Kiosk revoked');
  };
  return (
    <section className="card stack g12" aria-label="Kiosks">
      <div className="row between g8"><strong>Kiosks</strong><button type="button" className="link-btn small" onClick={st.reload}>Refresh</button></div>
      <span className="xs faint">A kiosk is a tablet or laptop at your event. Candidates sign in with a code sent to their email, agree to share, build their resume step by step and print it. The screen wipes itself after each person.</span>
      <Loading st={st} empty={emptyIf((d) => !d.length, 'No kiosks yet.')}>{(rows) => (
        <div className="table-wrap"><table className="table"><thead><tr><th>Kiosk</th><th>Group</th><th>Status</th><th>Today</th><th>Ends</th><th /></tr></thead>
          <tbody>{rows.map((k) => (
            <tr key={k.id} data-testid="kiosk-row">
              <td className="small"><strong>{k.label}</strong>{k.lastSeenAt && <div className="xs faint">last seen {when(k.lastSeenAt)}</div>}</td>
              <td className="small">{k.groupName}</td>
              <td className="small"><span className={`badge ${tone[k.state]}`}>{KIOSK_STATE[k.state]}</span></td>
              <td className="small" data-testid="kiosk-today">{k.sessionsToday} sign-in{k.sessionsToday === 1 ? '' : 's'} · {k.printsToday} print{k.printsToday === 1 ? '' : 's'}</td>
              <td className="small">{when(k.expiresAt)}</td>
              <td>{canManage && (k.state === 'active' || k.state === 'idle') && <button type="button" className="link-btn small" disabled={busy} onClick={() => revoke(k)}>Revoke</button>}</td>
            </tr>
          ))}</tbody></table></div>
      )}</Loading>
      {made && (
        <div className="well stack g8 small" role="status">
          <strong>“{made.label}” is ready. Open this link on the kiosk device — it’s shown only once.</strong>
          <div className="row g12" style={{ alignItems: 'center' }}>
            <Qr url={made.url} />
            <div className="stack g4" style={{ minWidth: 0, flex: '1 1 240px' }}>
              <code style={{ userSelect: 'all', overflowWrap: 'anywhere' }} data-testid="kiosk-url">{made.url}</code>
              <span className="xs faint">Works until {when(made.expiresAt)}. Leaving the kiosk screen needs the exit PIN you chose.</span>
              <div className="row g8">
                <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} onClick={() => navigator.clipboard?.writeText(made.url).then(() => toast('Link copied'), () => toast('Copy the link by hand'))}>Copy link</button>
                <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} onClick={() => downloadQrPng(made.url, qrFileName(made.label, 'kiosk')).catch((e) => toast(e.message))}>Download QR (PNG)</button>
                <button type="button" className="link-btn xs" onClick={() => setMade(null)}>Hide</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {canManage && groups.length > 0 && (
        <form className="stack g12" aria-label="New kiosk" onSubmit={create}>
          <div className="row g12" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '2 1 200px' }}><label className="label" htmlFor="k-group">Group</label><select id="k-group" className="input" style={inputStyle} value={f.groupId} onChange={(e) => setF({ ...f, groupId: e.target.value })}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
            <div className="field" style={{ flex: '1 1 140px' }}><label className="label" htmlFor="k-label">Label</label><input id="k-label" className="input" style={inputStyle} maxLength={40} placeholder="Stall 1" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
            <div className="field" style={{ flex: '1 1 180px' }}><label className="label" htmlFor="k-exp">Works until</label><select id="k-exp" className="input" style={inputStyle} value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })}>{days.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></div>
            <div className="field" style={{ flex: '1 1 120px' }}><label className="label" htmlFor="k-pin">Exit PIN (4–6 digits)</label><input id="k-pin" className="input" style={inputStyle} inputMode="numeric" autoComplete="off" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} /></div>
          </div>
          <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy || !ok}>Make kiosk link</button>
        </form>
      )}
    </section>
  );
}
