import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { placeOrder } from '../lib/customerStore';
import Header from '../components/Header';
import { Spinner } from '../components/ui';
import { useFlow } from '../lib/flow';
import { isUpi } from '../lib/format';
import { createOrder, pay } from '../services/api';
import { PLANS, PROMISES, inr } from '../lib/pricing';

export default function Checkout() {
  const nav = useNavigate();
  const { role, addon, setAddon, setOrderId } = useFlow();
  const { user } = useAuth();
  const [method, setMethod] = useState('upi');
  const [upi, setUpi] = useState('');
  const [touched, setTouched] = useState(false);
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState('');

  const total = addon ? PLANS.launch.price : PLANS.expert.price;
  const upiOk = isUpi(upi);
  const showUpiErr = method === 'upi' && touched && !upiOk;
  const disabled = paying || (method === 'upi' && !upiOk) || user?.role !== 'customer';

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (disabled) return;
    setPaying(true);
    setErr('');
    try {
      const plan = addon ? 'launch' : 'expert';
      const order = await createOrder({ planId: plan, role, addon });
      await pay({ orderId: order.orderId, method, upi });
      const id = placeOrder({ plan, role, method: method === 'upi' ? 'UPI' : 'Card' }); // live app: the server returns the order id
      setOrderId(id);
      nav(`/me/orders/${id}`, { state: { justPaid: true } });
    } catch {
      setErr('Payment didn’t go through. You haven’t been charged — please try again.');
      setPaying(false);
    }
  };

  return (
    <>
      <Header variant="flow" />
      <main className="container split rise" style={{ maxWidth: 1040, padding: '48px 24px 96px' }}>
        <section className="main stack g20" aria-label="Your order">
          <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={() => nav('/scan')}>← Back to your report</button>
          <h1 className="display" style={{ fontSize: 36 }}>Expert rewrite</h1>
          <div className="card stack g16">
            <div className="row between"><span>Expert rewrite · {role || 'your target role'}</span><strong>{inr(PLANS.expert.price)}</strong></div>
            <label className="option" data-on={addon}>
              <input type="checkbox" checked={addon} onChange={() => setAddon(!addon)} style={{ borderRadius: 4 }} />
              <span className="stack g4" style={{ flex: 1 }}><strong>Upgrade to Career Launch</strong><span className="small muted">Adds LinkedIn makeover, cover letters and a 1:1 mentor call.</span></span>
              <strong>+{inr(PLANS.launch.price - PLANS.expert.price)}</strong>
            </label>
            <hr className="divider" />
            <div className="row between" style={{ fontSize: 18 }}><strong>Total</strong><strong>{inr(total)}</strong></div>
          </div>
          <ul className="stack g8 small muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Delivered in {PROMISES.delivery}, revisions included</li>
            <li>You approve before anything is final</li>
            <li>{PROMISES.refund}</li>
          </ul>
        </section>

        <form className="side card stack g20" aria-label="Payment" onSubmit={submit} noValidate>
          <fieldset className="stack g8" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="strong" style={{ marginBottom: 10 }}>Pay with</legend>
            {[['upi', 'UPI', 'GPay · PhonePe · Paytm'], ['card', 'Card or netbanking', 'Visa · RuPay · Mastercard']].map(([id, label, hint]) => (
              <label key={id} className="option" data-on={method === id} style={{ alignItems: 'center' }}>
                <input type="radio" name="method" checked={method === id} onChange={() => setMethod(id)} style={{ marginTop: 0 }} />
                <strong style={{ flex: 1 }}>{label}</strong><span className="xs faint">{hint}</span>
              </label>
            ))}
          </fieldset>
          {method === 'upi' ? (
            <div className="field">
              <label htmlFor="upi" className="label">UPI ID</label>
              <input id="upi" className="input" value={upi} placeholder="name@bank" autoComplete="off" inputMode="email"
                onChange={(e) => setUpi(e.target.value)} onBlur={() => setTouched(true)}
                aria-invalid={showUpiErr ? 'true' : undefined} aria-describedby="upi-msg" />
              <span id="upi-msg" className={showUpiErr ? 'error' : 'help'}>
                {showUpiErr ? 'That doesn’t look like a UPI ID. It should look like name@bank.' : upiOk ? 'We’ll send a payment request to your UPI app.' : 'Example: saivarsha@okaxis'}
              </span>
            </div>
          ) : (
            <p className="small muted">You’ll enter card details on {PROMISES.paymentProvider}’s secure checkout.</p>
          )}
          {err && <p role="alert" className="error">{err}</p>}
          {!user && <div className="well small">Sign in or create a free account first — your order, drafts and invoices live in your dashboard. <Link to="/login?next=%2Fcheckout">Sign in</Link> · <Link to="/signup?next=%2Fcheckout">Create account</Link></div>}
          {user && user.role !== 'customer' && <div className="well small">You’re signed in with an {user.role} account. Orders need a customer account.</div>}
          <button type="submit" className="btn btn-ink btn-xl" disabled={disabled} aria-busy={paying}>
            {paying && <Spinner />}{paying ? 'Waiting for your UPI app…' : `Pay ${inr(total)}`}
          </button>
          <span className="xs muted" style={{ textAlign: 'center' }}>By paying you agree to our <Link to="/terms">Terms</Link> and <Link to="/refund-policy">Refund policy</Link>.</span>
          <span className="xs faint" style={{ textAlign: 'center' }}>Secured by {PROMISES.paymentProvider} · GST invoice emailed · full refund if we don’t deliver</span>
        </form>
      </main>
    </>
  );
}
