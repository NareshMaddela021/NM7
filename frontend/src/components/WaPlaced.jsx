// After "Buy on WhatsApp": the order number, a tappable WhatsApp link (in case the app didn't open) and what happens next.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog } from './ui';
import { reloadMe } from '../lib/customerStore';
import { WA_DELIVERY, WA_SAFETY, closePlaced, onPlaced } from '../lib/waPay';

const rs = (paise) => `Rs ${(paise / 100).toLocaleString('en-IN')}`;

export default function WaPlaced() {
  const [p, setP] = useState(null);
  useEffect(() => onPlaced(setP), []);
  if (!p) return null;
  return (
    <Dialog title="Your order is waiting for payment" onClose={closePlaced}>
      <div className="stack g12" data-testid="wa-placed">
        <strong style={{ fontSize: 20 }}>Your order is waiting for payment</strong>
        <div className="well stack g4">
          <span className="small muted">Order number</span>
          <strong className="mono" style={{ fontSize: 22 }} data-testid="wa-order-no">{p.orderId}</strong>
          <span className="small">{p.item} · {rs(p.amount)}</span>
        </div>
        <span className="small">{p.opened ? 'WhatsApp opened in a new tab with your order number. Send the message there.' : 'Tap below to open WhatsApp with your order number, then send the message.'}{p.replyHours ? ` ${p.replyHours}.` : ''}</span>
        <a className="btn btn-ink btn-lg" href={p.waUrl} target="_blank" rel="noopener noreferrer" data-testid="wa-open-chat">Open WhatsApp</a>
        <ul className="stack g4 small muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>{WA_SAFETY}</li>
          <li>{WA_DELIVERY}</li>
        </ul>
        {p.orderLink ? <Link to={p.orderLink} className="btn btn-outline" onClick={() => { closePlaced(); reloadMe(); }}>See my order</Link>
          : <button type="button" className="btn btn-outline" onClick={closePlaced}>Done</button>}
      </div>
    </Dialog>
  );
}
