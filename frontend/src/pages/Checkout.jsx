import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { placeOrder } from '../lib/customerStore';
import Header from '../components/Header';
import { Spinner } from '../components/ui';
import { useFlow } from '../lib/flow';
import { createOrder, pay } from '../services/api';
import { PLANS, PROMISES, inr } from '../lib/pricing';

export default function Checkout() {
  const nav = useNavigate();
  const { role, addon, setAddon, setOrderId } = useFlow();
  const { user } = useAuth();
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState('');
  const unpaid = useRef({}); // plan → order created but not paid yet (e.g. the window was closed), reused on retry

  const total = addon ? PLANS.launch.price : PLANS.expert.price;
  const disabled = paying || user?.role !== 'customer';

  const submit = async (e) => {
    e.preventDefault();
    if (disabled) return;
    setPaying(true);
    setErr('');
    try {
      const plan = addon ? 'launch' : 'expert';
      const order = unpaid.current[plan] || (unpaid.current[plan] = await createOrder({ planId: plan, role })); // the server sets the price
      const paid = await pay(order); // Razorpay's own window (UPI, card, netbanking), then the server confirms it
      // Live: the dashboard copy uses the server's order id, invoice and payment id. Preview: made up here.
      const id = placeOrder({ plan, role, method: paid.method, id: paid.orderId, invoice: paid.invoiceNo, payId: paid.paymentId });
      unpaid.current = {};
      setOrderId(id);
      nav(`/me/orders/${id}`, { state: { justPaid: true } });
    } catch (x) {
      setErr(x.code ? x.message : 'Payment didn’t go through. You haven’t been charged — please try again.');
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
          <div className="stack g8">
            <strong>Pay with UPI, card or netbanking</strong>
            <p className="small muted" style={{ margin: 0 }}>When you press Pay, {PROMISES.paymentProvider}’s secure window opens. Choose GPay, PhonePe, Paytm or any UPI app, a Visa / RuPay / Mastercard card, or netbanking there. We never see your card or UPI PIN.</p>
          </div>
          {err && <p role="alert" className="error">{err}</p>}
          {!user && <div className="well small">Sign in or create a free account first — your order, drafts and invoices live in your dashboard. <Link to="/login?next=%2Fcheckout">Sign in</Link> · <Link to="/signup?next=%2Fcheckout">Create account</Link></div>}
          {user && user.role !== 'customer' && <div className="well small">You’re signed in with an {user.role} account. Orders need a customer account.</div>}
          <button type="submit" className="btn btn-ink btn-xl" disabled={disabled} aria-busy={paying}>
            {paying && <Spinner />}{paying ? 'Waiting for your payment…' : `Pay ${inr(total)}`}
          </button>
          <span className="xs muted" style={{ textAlign: 'center' }}>By paying you agree to our <Link to="/terms">Terms</Link> and <Link to="/refund-policy">Refund policy</Link>.</span>
          <span className="xs faint" style={{ textAlign: 'center' }}>Secured by {PROMISES.paymentProvider} · GST invoice emailed · full refund if we don’t deliver</span>
        </form>
      </main>
    </>
  );
}
