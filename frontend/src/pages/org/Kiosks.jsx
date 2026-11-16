// Kiosk links for events (Phase 3A): create one per stall (group, label, expiry, exit PIN), see which kiosks are in
// use today, revoke at once. Used in the coordinator portal (/org/:orgId/kiosks) and the admin console. The server
// checks everything (feature switch, scope, role); viewers get the list without the buttons.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useToast } from '../../components/ui';
import { KIOSK_STATE, PIN_RE, expiryOptions } from '../../lib/kiosk';
import { downloadQrPng, qrFileName } from '../../lib/qr';
import { Loading, http, useAction, useApi, when } from '../admin/live/common';
import { Empty } from '../me/kit';
import '../../styles/me-kit.css';
import '../../styles/org-drives.css';

const tone = { active: 'mchip-ok', idle: 'mchip-neutral', expired: 'mchip-neutral', revoked: 'mchip-warn' };

function Qr({ url }) {
  const [src, setSrc] = useState('');
  useEffect(() => { let off = false; QRCode.toDataURL(url, { width: 240, margin: 1 }).then((u) => !off && setSrc(u)); return () => { off = true; }; }, [url]);
  return src ? <img src={src} width={140} height={140} alt="QR code for the kiosk link" className="ks-made-qr" /> : null;
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
    <section className="mcard ks-admin" aria-label="Kiosks">
      <header className="mcard-h">
        <span className="mcard-ic" aria-hidden="true">▣</span>
        <span className="mcard-ht"><strong className="mcard-title">Kiosks</strong><span className="mcard-sub">A kiosk is a tablet or laptop at your event. Candidates sign in with a code sent to their email, agree to share, build their resume step by step and print it. The screen wipes itself after each person.</span></span>
        <span className="mcard-actions"><button type="button" className="btn btn-outline btn-sm" onClick={st.reload}>Refresh</button></span>
      </header>
      <Loading st={st}>{(rows) => (rows.length === 0 ? <Empty shape="college" tint="college" compact title="No kiosks yet.">{canManage ? 'Make a kiosk link below and open it on the tablet at your stall.' : 'Your coordinators haven’t made one yet.'}</Empty> : (
        <ul className="ks-list" aria-label="Kiosk links">
          {rows.map((k) => (
            <li key={k.id} className={`ks-item ks-${k.state}`} data-testid="kiosk-row">
              <div className="ks-item-top">
                <span className="ks-item-ic" aria-hidden="true">▣</span>
                <span className="stack g4" style={{ minWidth: 0, flex: 1 }}><strong className="ks-item-name">{k.label}</strong><span className="xs muted">{k.groupName}</span></span>
                <span className={`mchip ${tone[k.state]}`}>{KIOSK_STATE[k.state]}</span>
              </div>
              <div className="ks-item-facts">
                <span className="ks-fact" data-testid="kiosk-today">{k.sessionsToday} sign-in{k.sessionsToday === 1 ? '' : 's'} · {k.printsToday} print{k.printsToday === 1 ? '' : 's'}</span>
                <span className="xs muted">Ends {when(k.expiresAt)}{k.lastSeenAt ? ` · last seen ${when(k.lastSeenAt)}` : ''}</span>
              </div>
              {canManage && (k.state === 'active' || k.state === 'idle') && <button type="button" className="btn btn-outline btn-sm ks-revoke" disabled={busy} onClick={() => revoke(k)}>Revoke</button>}
            </li>
          ))}
        </ul>
      ))}</Loading>
      {made && (
        <div className="ks-made" role="status">
          <strong>“{made.label}” is ready. Open this link on the kiosk device — it’s shown only once.</strong>
          <div className="ks-made-body">
            <Qr url={made.url} />
            <div className="stack g8" style={{ minWidth: 0, flex: '1 1 240px' }}>
              <code className="ks-made-url" data-testid="kiosk-url">{made.url}</code>
              <span className="xs faint">Works until {when(made.expiresAt)}. Leaving the kiosk screen needs the exit PIN you chose.</span>
              <div className="row g8" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => navigator.clipboard?.writeText(made.url).then(() => toast('Link copied'), () => toast('Copy the link by hand'))}>Copy link</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => downloadQrPng(made.url, qrFileName(made.label, 'kiosk')).catch((e) => toast(e.message))}>Download QR (PNG)</button>
                <button type="button" className="link-btn xs" onClick={() => setMade(null)}>Hide</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {canManage && groups.length > 0 && (
        <form className="ks-new" aria-label="New kiosk" onSubmit={create}>
          <span className="mkicker">New kiosk link</span>
          <div className="ks-new-fields">
            <div className="field"><label className="label" htmlFor="k-group">Group</label><select id="k-group" className="input" value={f.groupId} onChange={(e) => setF({ ...f, groupId: e.target.value })}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
            <div className="field"><label className="label" htmlFor="k-label">Label</label><input id="k-label" className="input" maxLength={40} placeholder="Stall 1" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
            <div className="field"><label className="label" htmlFor="k-exp">Works until</label><select id="k-exp" className="input" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })}>{days.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></div>
            <div className="field"><label className="label" htmlFor="k-pin">Exit PIN (4–6 digits)</label><input id="k-pin" className="input" inputMode="numeric" autoComplete="off" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} /></div>
          </div>
          <button type="submit" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={busy || !ok}>Make kiosk link</button>
        </form>
      )}
    </section>
  );
}
