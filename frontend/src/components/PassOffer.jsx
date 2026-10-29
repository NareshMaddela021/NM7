// The annual student pass (P1) on every pay screen, marked "Best value": one payment unlocks for 12 months unlimited
// PDF / Word downloads and the Tailor, Interview (with voice practice) and LinkedIn packs. Follows the payment mode
// (WhatsApp order now, Razorpay later; Off: not shown). Hidden while a pass is active. Also the dashboard line
// "Pass active until <date>".
import { useEffect, useState } from 'react';
import { Spinner, useToast } from './ui';
import CodeBox from './CodeBox';
import { createOrder, pay } from '../services/api';
import { http } from '../services/http';
import { WA_PAY_TEXT, buyOnWhatsApp } from '../lib/waPay';
import { reloadMe } from '../lib/customerStore';

const rs = (n) => `Rs ${Number(n).toLocaleString('en-IN', Number.isInteger(Number(n)) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const PASS_WHAT = 'Unlimited PDF and Word downloads, the Tailor pack, the Interview pack (with voice practice) and the LinkedIn pack, for 12 months.';

let cache = null;
const listeners = new Set();
const publish = (d) => { cache = d; listeners.forEach((f) => f(d)); };
/** GET /api/me/pass once per page load (signed-in customers only; null otherwise); every user of it updates together. */
export function usePass() {
  const [st, setSt] = useState(cache);
  useEffect(() => {
    listeners.add(setSt);
    if (!cache) http('/api/me/pass').then(publish, () => {});
    return () => { listeners.delete(setSt); };
  }, []);
  return [st, publish];
}

/** onBought(): after a Razorpay payment or a free code (a WhatsApp order unlocks when the admin marks it paid). */
export default function PassOffer({ onBought, compact = false }) {
  const toast = useToast();
  const [st, setSt] = usePass();
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState(null);
  if (!st || st.active || !st.onSale) return null;
  const price = quote ? quote.final / 100 : st.price;
  const done = async () => {
    const fresh = await http('/api/me/pass').catch(() => null);
    if (fresh) setSt(fresh);
    reloadMe();
    toast('Annual pass active');
    onBought?.();
  };
  const buy = async () => {
    setBusy(true);
    try {
      if (st.mode === 'whatsapp') {
        const r = await buyOnWhatsApp({ planId: 'annual_pass', ...(quote?.code ? { code: quote.code } : {}) });
        if (r?.unlocked) await done();
        return;
      }
      await pay(await createOrder({ planId: 'annual_pass', code: quote?.code }));
      await done();
    } catch (e) { toast(e.message || 'Payment didn’t go through. You haven’t been charged.'); } finally { setBusy(false); }
  };
  return (
    <div className="well stack g8" data-testid="pass-offer" style={{ borderColor: 'var(--accent)' }}>
      <div className="row between g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <strong className="small">Annual student pass · {rs(st.price)} / year</strong>
        <span className="badge b-success">Best value</span>
      </div>
      <span className="xs muted">{PASS_WHAT}{compact ? '' : ' Things you buy separately stay yours after the year; your resumes are never locked.'}</span>
      <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={buy} data-testid="pass-buy">
        {busy && <Spinner />}{st.mode === 'whatsapp' ? (busy ? 'Opening WhatsApp…' : 'Get the pass on WhatsApp') : busy ? 'Waiting for your payment…' : `Get the pass ${rs(price)}`}
      </button>
      {!compact && <CodeBox item="annual_pass" onApplied={setQuote} disabled={busy} onUnlocked={done} />}
      {st.mode === 'whatsapp' && <span className="xs faint">{WA_PAY_TEXT}</span>}
    </div>
  );
}

/** "Pass active until 28 Oct 2027" on the dashboard (nothing without a pass). */
export function PassActive() {
  const [st] = usePass();
  if (!st?.active) return null;
  return (
    <div className="card row between g8" data-testid="pass-active" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="stack g2"><strong className="small">Pass active until {st.untilText}</strong><span className="xs muted">{PASS_WHAT}</span></span>
      <span className="badge b-success">Annual pass</span>
    </div>
  );
}
