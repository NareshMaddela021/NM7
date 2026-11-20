import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { placeOrder } from '../lib/customerStore';
import Header from '../components/Header';
import { Spinner } from '../components/ui';
import { useFlow } from '../lib/flow';
import { PLANS, PROMISES, inr, inrExact } from '../lib/pricing';
import CodeBox from '../components/CodeBox';
import PayRetry from '../components/PayRetry';
import { PAY_SOON, buy, payError, usePayMode } from '../lib/payMode';
import { gstinProblem } from '../lib/orgBilling';
import { GST_STATES } from '../lib/gstStates';

/** Optional: invoice to a company for an input tax credit. Sent as `billing` only when a company name or GSTIN is typed. */
function GstFields({ f, setF, disabled, error }) {
  const local = gstinProblem(f.gstin, f.stateCode);
  return (
    <details className="well stack g8" data-testid="checkout-gst" open={f.open} onToggle={(e) => setF({ ...f, open: e.currentTarget.open })} style={{ margin: 0 }}>
      <summary className="small strong" style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>Need a GST invoice for your company?</summary>
      <span className="xs muted">Optional. Add your company’s name and GSTIN to claim input tax credit. Leave empty for an invoice in your own name.</span>
      <div className="field"><label className="label" htmlFor="gst-name">Company name</label>
        <input id="gst-name" className="input" maxLength={150} autoComplete="organization" disabled={disabled} value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} /></div>
      <div className="field"><label className="label" htmlFor="gst-no">GSTIN</label>
        <input id="gst-no" className="input mono" maxLength={15} autoComplete="off" disabled={disabled} value={f.gstin} aria-invalid={local || error ? 'true' : undefined} aria-describedby={local || error ? 'gst-err' : undefined}
          onChange={(e) => { const g = e.target.value.toUpperCase().replace(/\s/g, ''); setF({ ...f, gstin: g, stateCode: g.length >= 2 && GST_STATES.some(([c]) => c === g.slice(0, 2)) ? g.slice(0, 2) : f.stateCode }); }} /></div>
      <div className="field"><label className="label" htmlFor="gst-state">State</label>
        <select id="gst-state" className="input" disabled={disabled} value={f.stateCode} onChange={(e) => setF({ ...f, stateCode: e.target.value })}>
          <option value="">Choose…</option>{GST_STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select></div>
      {(local || error) && <span id="gst-err" className="error" role="alert">{local || error}</span>}
    </details>
  );
}
const billingOf = (f) => (f.companyName.trim() || f.gstin.trim() ? { companyName: f.companyName.trim(), gstin: f.gstin.trim(), stateCode: f.stateCode, address: '' } : null);

export default function Checkout() {
  const nav = useNavigate();
  const { role, addon, setAddon, setOrderId, report } = useFlow();
  const { user } = useAuth();
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState(''); // the payment didn't finish (shown with Try again)
  const [gstErr, setGstErr] = useState(''); // the server refused the GST details (e.g. a wrong GSTIN)
  const [gst, setGst] = useState({ open: false, companyName: '', gstin: '', stateCode: '' });
  const [quote, setQuote] = useState(null); // a discount code applied (for this plan)

  const listTotal = addon ? PLANS.launch.price : PLANS.expert.price;
  const total = quote ? quote.final / 100 : listTotal;
  const code = quote?.code;
  const pm = usePayMode();
  const mode = pm?.mode; // undefined while loading
  const gstLocal = gstinProblem(gst.gstin, gst.stateCode);
  const disabled = paying || user?.role !== 'customer' || !mode || mode === 'off';

  const submit = async (e) => {
    e?.preventDefault();
    if (disabled) return;
    if (gstLocal) { setGst({ ...gst, open: true }); return; }
    setPaying(true); // the button stays disabled until the window closes: one order per press
    setErr(''); setGstErr('');
    const plan = addon ? 'launch' : 'expert';
    const billing = billingOf(gst);
    try {
      // the server sets the price; an order made earlier for the same plan and code (window closed) is reused
      const paid = await buy({ planId: plan, role: role || null, ...(code ? { code } : {}), ...(billing ? { billing } : {}) });
      // Live: the dashboard copy uses the server's order id, invoice and payment id. Preview: made up here.
      const id = placeOrder({ plan, role, method: paid.method, id: paid.orderId, invoice: paid.invoiceNo, payId: paid.paymentId });
      setOrderId(id);
      nav(`/me/orders/${id}`, { state: { justPaid: true } });
    } catch (x) {
      if (['bad_gstin', 'bad_state', 'company_required'].includes(x.code)) { setGstErr(x.message); setGst((g) => ({ ...g, open: true })); } else setErr(payError(x));
      setPaying(false);
    }
  };

  return (
    <>
      <Header variant="flow" />
      <main className="container split rise" style={{ maxWidth: 1040, padding: '48px 24px 96px' }}>
        <section className="main stack g20" aria-label="Your order">
          {report && <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={() => nav('/scan')}>Back to your report</button>}
          <h1 className="display" style={{ fontSize: 36 }}>{PLANS[addon ? 'launch' : 'expert'].name}</h1>
          <div className="card stack g16">
            <div className="row between"><span>Expert rewrite · {role || 'your target role'}</span><strong>{inr(PLANS.expert.price)}</strong></div>
            <label className="option" data-on={addon}>
              <input type="checkbox" checked={addon} onChange={() => { setAddon(!addon); setQuote(null); }} style={{ borderRadius: 4 }} disabled={!!quote} />
              <span className="stack g4" style={{ flex: 1 }}><strong>Upgrade to Career Launch</strong><span className="small muted">Adds LinkedIn makeover, cover letters and a 1:1 mentor call.</span></span>
              <strong>+{inr(PLANS.launch.price - PLANS.expert.price)}</strong>
            </label>
            <hr className="divider" />
            {quote && <div className="row between small"><span>Code {quote.code}</span><span>−{inrExact(quote.discount / 100)}</span></div>}
            <div className="row between" style={{ fontSize: 18 }}><strong>Total</strong><strong>{inrExact(total)}</strong></div>
          </div>
          <ul className="stack g8 small muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Delivered in {PROMISES.delivery}, revisions included</li>
            <li>You approve before anything is final</li>
            <li>{PROMISES.refund}</li>
          </ul>
        </section>

        <form className="side card stack g20" aria-label="Payment" onSubmit={submit} noValidate>
          {mode === 'off' ? (
            <div className="stack g8" data-testid="checkout-soon">
              <strong>{PAY_SOON}</strong>
              <p className="small muted" style={{ margin: 0 }}>Online orders open soon. Nothing can be bought yet.</p>
            </div>
          ) : (
            <div className="stack g8">
              <strong>Pay with UPI, card, netbanking or wallet</strong>
              <p className="small muted" style={{ margin: 0 }}>When you press Pay, {PROMISES.paymentProvider}’s secure window opens. Choose GPay, PhonePe, Paytm or any UPI app, a Visa / RuPay / Mastercard card, netbanking or a wallet there. We never see your card or UPI details.</p>
            </div>
          )}
          {user?.role === 'customer' && mode && <CodeBox key={addon ? 'launch' : 'expert'} item={addon ? 'launch' : 'expert'} onApplied={setQuote} disabled={paying}
            onUnlocked={(r) => { setOrderId(r.orderId); nav(`/me/orders/${r.orderId}`, { state: { justPaid: true } }); }} />}
          {user?.role === 'customer' && mode === 'razorpay' && <GstFields f={gst} setF={(v) => { setGst(v); setGstErr(''); }} disabled={paying} error={gstErr} />}
          <PayRetry error={err} busy={paying} onRetry={() => submit()} />
          {!user && <div className="well small">Sign in or create a free account first — your order, drafts and invoices live in your dashboard. <Link to="/login?next=%2Fcheckout">Sign in</Link> · <Link to="/signup?next=%2Fcheckout">Create account</Link></div>}
          {user && user.role !== 'customer' && <div className="well small">You’re signed in with an {user.role} account. Orders need a customer account.</div>}
          <button type="submit" className="btn btn-ink btn-xl" disabled={disabled} aria-busy={paying}>
            {paying && <Spinner />}{mode === 'off' ? PAY_SOON : paying ? 'Waiting for your payment…' : `Pay ${inrExact(total)}`}
          </button>
          {mode !== 'off' && <span className="xs muted" style={{ textAlign: 'center' }}>By paying you agree to our <Link to="/terms">Terms</Link> and <Link to="/refund-policy">Refund policy</Link>.</span>}
          {mode === 'razorpay' && <span className="xs faint" style={{ textAlign: 'center' }}>Secured by {PROMISES.paymentProvider} · GST invoice emailed · full refund if we don’t deliver</span>}
        </form>
      </main>
    </>
  );
}
