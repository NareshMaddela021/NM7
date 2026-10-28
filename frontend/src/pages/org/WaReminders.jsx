// WhatsApp / SMS reminders without a paid gateway: write the message (only {name} is filled in per student), then
// one tap per student opens your own WhatsApp with the message ready (wa.me), or your SMS app on a phone (sms:).
// Tick each one sent; "18 of 40 sent". Phone-list CSV for a WhatsApp Business broadcast list. Only students who gave
// a mobile number and allow reminders are listed.
import { useState } from 'react';
import { Dialog, Spinner, useToast } from '../../components/ui';
import { API_BASE } from '../../services/http';
import { http, useAction } from '../admin/live/common';

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
  return (
    <Dialog showTitle wide title={`WhatsApp / SMS · ${ids.length} selected`} onClose={onClose}>
      {!b ? (
        <div className="stack g12" data-testid="wa-compose">
          <span className="small muted">No paid service: each link opens your own WhatsApp (or SMS app) with the message ready. Only <span className="mono">{'{name}'}</span> is filled in (the first name). Students without a mobile number, or who switched reminders off, are left out.</span>
          <label className="small">Message <textarea className="input" rows={4} maxLength={600} value={msg} onChange={(e) => setMsg(e.target.value)} data-testid="wa-message" /></label>
          <div className="row g8" role="group" aria-label="Send by">
            <button type="button" className={`btn ${channel === 'whatsapp' ? 'btn-ink' : 'btn-outline'}`} aria-pressed={channel === 'whatsapp'} onClick={() => setChannel('whatsapp')}>WhatsApp</button>
            {onPhone() && <button type="button" className={`btn ${channel === 'sms' ? 'btn-ink' : 'btn-outline'}`} aria-pressed={channel === 'sms'} onClick={() => setChannel('sms')} data-testid="wa-sms">SMS</button>}
          </div>
          <button type="button" className="btn btn-ink" disabled={busy || msg.trim().length < 5} onClick={make} style={{ alignSelf: 'flex-start' }} data-testid="wa-make">{busy && <Spinner />}Make the links</button>
        </div>
      ) : (
        <div className="stack g12" data-testid="wa-batch">
          <div className="row between g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <strong data-testid="wa-progress">{b.sent} of {b.total} sent</strong>
            <button type="button" className="btn btn-outline" style={{ minHeight: 32 }} disabled={busy} onClick={csv} data-testid="wa-csv">Phone list (CSV)</button>
          </div>
          {(b.skipped.noPhone > 0 || b.skipped.optedOut > 0) && <span className="xs muted">Left out: {b.skipped.noPhone} without a mobile number, {b.skipped.optedOut} who switched reminders off.</span>}
          <div className="well xs" style={{ whiteSpace: 'pre-wrap' }}>{b.message}</div>
          <ul className="stack g4" style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: '50vh', overflow: 'auto' }}>
            {b.items.map((it) => (
              <li key={it.membershipId} className="row between g8" style={{ flexWrap: 'wrap', borderBottom: '1px solid var(--border)', padding: '6px 0' }} data-testid="wa-item">
                <span className="small">{it.roll ? <span className="mono">{it.roll} · </span> : null}{it.name}</span>
                <span className="row g8" style={{ alignItems: 'center' }}>
                  <a className="btn btn-outline" style={{ minHeight: 32 }} href={b.channel === 'sms' ? it.sms : it.whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => !it.sent && sent(it)} data-testid="wa-link">{b.channel === 'sms' ? 'Send SMS' : 'Send on WhatsApp'}</a>
                  <label className="row g4 xs"><input type="checkbox" checked={it.sent} onChange={(e) => sent(it, e.target.checked)} data-testid="wa-sent" /> Sent</label>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
