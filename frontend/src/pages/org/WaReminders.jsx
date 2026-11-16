// WhatsApp / SMS reminders without a paid gateway: write the message (only {name} is filled in per student), then
// one tap per student opens your own WhatsApp with the message ready (wa.me), or your SMS app on a phone (sms:).
// Tick each one sent; "18 of 40 sent". Phone-list CSV for a WhatsApp Business broadcast list. Only students who gave
// a mobile number and allow reminders are listed.
import { useState } from 'react';
import { Dialog, Spinner, useToast } from '../../components/ui';
import { API_BASE } from '../../services/http';
import { http, useAction } from '../admin/live/common';
import '../../styles/me-kit.css';
import '../../styles/org-team.css';

const onPhone = () => typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);

export default function WaReminders({ base, ids, list, defaultMessage, onClose }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [msg, setMsg] = useState(defaultMessage || 'Hi {name}, a reminder from the placement office: please finish your resume on Nm7 today.');
  const [channel, setChannel] = useState('whatsapp');
  const [b, setB] = useState(null);
  const url = `${base}/wa-reminders`;
  const make = () => run(async () => setB(await http(url, { method: 'POST', body: { membershipIds: ids, message: msg, channel, list } })));
  const sent = (it, value = true) => http(`${url}/${b.id}/sent`, { method: 'POST', body: { membershipId: it.membershipId, sent: value } }).then(setB, (e) => toast(e.message));
  const csv = () => run(async () => {
    const r = await fetch(`${API_BASE}${url}/${b.id}/phones.csv`, { credentials: 'include' });
    if (!r.ok) throw new Error('Couldn’t download the list.');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'phone_list.csv'; a.click();
  });
  // round P, Phase 4: write the message in a card, pick the channel as a pill switch; then a progress bar and one row
  // per student with a big send button and a Sent tick
  return (
    <Dialog showTitle wide title={`WhatsApp / SMS · ${ids.length} selected`} onClose={onClose}>
      {!b ? (
        <div className="stack g12" data-testid="wa-compose">
          <span className="small muted">No paid service: each link opens your own WhatsApp (or SMS app) with the message ready. Only <span className="mono">{'{name}'}</span> is filled in (the first name). Students without a mobile number, or who switched reminders off, are left out.</span>
          <label className="field ow-msg"><span className="label">Message</span> <textarea className="input" rows={4} maxLength={600} value={msg} onChange={(e) => setMsg(e.target.value)} data-testid="wa-message" /><span className="xs muted ow-count">{msg.length} / 600</span></label>
          <div className="ow-switch" role="group" aria-label="Send by">
            <button type="button" className={`ow-opt ${channel === 'whatsapp' ? 'on' : ''}`} aria-pressed={channel === 'whatsapp'} onClick={() => setChannel('whatsapp')}>WhatsApp</button>
            {onPhone() && <button type="button" className={`ow-opt ${channel === 'sms' ? 'on' : ''}`} aria-pressed={channel === 'sms'} onClick={() => setChannel('sms')} data-testid="wa-sms">SMS</button>}
          </div>
          <button type="button" className="btn btn-signal" disabled={busy || msg.trim().length < 5} onClick={make} style={{ alignSelf: 'flex-start' }} data-testid="wa-make">{busy && <Spinner />}Make the links</button>
        </div>
      ) : (
        <div className="stack g12" data-testid="wa-batch">
          <div className="ow-progress">
            <div className="ow-progress-top">
              <strong data-testid="wa-progress">{b.sent} of {b.total} sent</strong>
              <button type="button" className="btn btn-outline btn-sm-ot" disabled={busy} onClick={csv} data-testid="wa-csv">Phone list (CSV)</button>
            </div>
            <span className="mbar mbar-ok" aria-hidden="true"><span style={{ width: `${b.total ? (b.sent / b.total) * 100 : 0}%` }} /></span>
          </div>
          {(b.skipped.noPhone > 0 || b.skipped.optedOut > 0) && <span className="xs muted">Left out: {b.skipped.noPhone} without a mobile number, {b.skipped.optedOut} who switched reminders off.</span>}
          <div className="ow-preview xs">{b.message}</div>
          <ul className="ow-list">
            {b.items.map((it) => (
              <li key={it.membershipId} className={`ow-row ${it.sent ? 'done' : ''}`} data-testid="wa-item">
                <span className="small ow-who">{it.roll ? <span className="mono">{it.roll} · </span> : null}{it.name}</span>
                <span className="ow-acts">
                  <a className={`btn ${it.sent ? 'btn-outline' : 'btn-signal'} btn-sm-ot`} href={b.channel === 'sms' ? it.sms : it.whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => !it.sent && sent(it)} data-testid="wa-link">{b.channel === 'sms' ? 'Send SMS' : 'Send on WhatsApp'}</a>
                  <label className="ot-choice ow-tick"><input type="checkbox" checked={it.sent} onChange={(e) => sent(it, e.target.checked)} data-testid="wa-sent" /> Sent</label>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
