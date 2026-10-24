// Refund request for one order — late delivery is refunded at once; anything else goes to our team (24-hour review).
// Quality complaints are offered a free re-do first.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { Icon, Spinner, TextField } from '../components/ui';
import { requestRefund } from '../services/api';
import { useMe, orderView, askRefund } from '../lib/customerStore';
import { useExpertOrders } from '../lib/expertStore';
import { PLANS, PROMISES, inr } from '../lib/pricing';
import { countdown, fmtDay } from './me/shared';

export default function Refund() {
  const { id } = useParams();
  const nav = useNavigate();
  const me = useMe();
  useExpertOrders();
  const raw = me.orders.find((o) => o.id === id);
  const o = raw ? orderView(raw) : null;
  const late = !!o?.x && o.deadline < Date.now() && o.sent.length === 0;
  const [reason, setReason] = useState(late ? 'late' : 'quality');
  const [details, setDetails] = useState('');
  const [step, setStep] = useState('form');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  if (!o) return <><Header variant="flow" /><main className="container stack g12" style={{ maxWidth: 720, padding: 40 }}><h1 className="display" style={{ fontSize: 28 }}>Order not found</h1><Link to="/me/orders">My orders</Link></main></>;
  const total = o.price + o.addons.reduce((t, a) => t + a.price, 0);
  const amount = inr(total);
  if (step === 'form' && (o.refund || o.refundRequest?.status === 'review')) {
    return (<><Header variant="flow" /><main className="container stack g12" style={{ maxWidth: 720, padding: 40 }}>
      <h1 className="display" style={{ fontSize: 28 }}>{o.refund ? `Refunded ${inr(o.refund.amount)}` : 'Refund under review'}</h1>
      <p className="muted">{o.refund ? `${o.refund.reason}. It reaches your account in ${PROMISES.refundDays}.` : 'Our team replies within 24 hours on WhatsApp and email.'}</p>
      <Link to={`/me/orders/${id}`}>Back to my order</Link></main></>);
  }
  const REASONS = [
    ['late', `First draft not delivered within ${PROMISES.delivery}`, late ? 'The promised window has passed without a draft — this is refunded at once.' : 'Only available once the delivery window has passed without a draft.', !late],
    ['quality', 'The work wasn’t what was promised', 'e.g. generic rewrite, wrong role, ignored my intake answers.'],
    ['other', 'Something else', 'Tell us below and our team will review it.'],
  ];
  const needDetails = reason !== 'late';
  const cantContinue = needDetails && details.trim().length < 10;
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const decided = await requestRefund(id, { reason, details: details.trim() }); // live app: the server decides
      setResult(askRefund(id, { reason, details: details.trim() }, decided));
      setStep('done');
    } catch (e) {
      setErr(e.message);
    } finally { setBusy(false); }
  };

  return (
    <>
      <Header variant="flow" />
      {step === 'form' && (
        <main className="container split" style={{ maxWidth: 1040, padding: '48px 24px 88px' }}>
          <section className="main stack g20 rise">
            <Link to={`/me/orders/${id}`} className="btn btn-ghost" style={{ alignSelf: 'flex-start', paddingLeft: 0 }}>← Back to my order</Link>
            <h1 className="display" style={{ fontSize: 40 }}>Request a refund</h1>
            <p className="lead" style={{ fontSize: 17 }}>Our promise: if we don’t fulfil the service, you get your money back in full. Tell us what happened.</p>
            <fieldset className="stack g8" style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="strong" style={{ marginBottom: 10 }}>What went wrong?</legend>
              {REASONS.map(([v, l, d, off]) => (
                <label key={v} className="option" data-on={reason === v} style={off ? { opacity: 0.5 } : undefined}>
                  <input type="radio" name="reason" checked={reason === v} disabled={off} onChange={() => setReason(v)} />
                  <span className="stack g4"><strong>{l}</strong><span className="small muted">{d}</span></span>
                </label>
              ))}
            </fieldset>
            {reason === 'quality' && o.x && (
              <div className="row between g12 well rise">
                <span className="stack g4" style={{ flex: '1 1 260px' }}><strong>Want it fixed instead?</strong><span className="small muted">We re-do it free first, using your comments. If it’s still not right, you can come back here.</span></span>
                <button type="button" className="btn btn-outline" onClick={() => nav(`/me/orders/${id}?redo=1`)}>Ask for a free re-do</button>
              </div>
            )}
            <TextField textarea label={`Details · ${needDetails ? 'required for this reason' : 'optional'}`} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="What did you expect, and what did you get?" />
            <button type="button" className="btn btn-ink btn-lg" style={{ alignSelf: 'flex-start' }} disabled={cantContinue} onClick={() => setStep('confirm')}>Continue</button>
          </section>
          <aside className="side stack g16">
            <div className="card stack g12">
              <span className="mono faint">ORDER #{id}</span>
              <div className="row between"><span>{PLANS[o.plan].name}{o.addons.length ? ` + ${o.addons.length} add-on${o.addons.length > 1 ? 's' : ''}` : ''}</span><strong>{amount}</strong></div>
              <div className="row between small muted"><span>Paid via {PROMISES.paymentProvider}</span><span>{fmtDay(o.paidAt)}</span></div>
              {o.x && <div className="row between small muted"><span>Delivery promise</span><span style={{ color: late ? 'var(--danger)' : 'var(--text)', fontWeight: 600 }}>{o.sent.length ? 'Draft delivered' : countdown(o.deadline).text}</span></div>}
            </div>
            <div className="stack g4" style={{ borderRadius: 20, padding: 20, background: reason === 'late' ? 'var(--successbg)' : 'var(--sunken)' }}>
              <strong style={{ color: reason === 'late' ? 'var(--success)' : 'var(--text)' }}>{reason === 'late' ? 'You’re eligible for a full refund' : 'We’ll review this within 24 hours'}</strong>
              <span className="small muted">{reason === 'late' ? 'The delivery window passed, so this is approved instantly — no questions asked.' : 'A team member checks your order and replies on WhatsApp and email. If we didn’t fulfil the service, you get a full refund.'}</span>
            </div>
            <Link to="/refund-policy" className="small">Read the full refund policy</Link>
          </aside>
        </main>
      )}

      {step === 'confirm' && (
        <main className="stack g20 rise" style={{ maxWidth: 560, margin: '0 auto', padding: '72px 24px' }}>
          <h1 className="display" style={{ fontSize: 36 }}>{reason === 'late' ? `Refund ${amount} and cancel this order?` : `Ask for a ${amount} refund?`}</h1>
          <ul className="stack g8 muted" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.55 }}>
            {reason === 'late' ? <li>Your expert stops work on this order.</li> : <li>Your expert keeps working while we review — nothing is lost.</li>}
            <li>You keep the free scan, your resumes and the builder.</li>
            <li>If approved, {amount} goes back to the account you paid from in {PROMISES.refundDays}.</li>
          </ul>
          {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
          <div className="row g12">
            <button type="button" className="btn btn-danger btn-lg" onClick={submit} disabled={busy}>{busy && <Spinner />}{reason === 'late' ? `Yes, refund ${amount}` : 'Send request'}</button>
            <button type="button" className="btn btn-outline btn-lg" onClick={() => setStep('form')}>Go back</button>
          </div>
        </main>
      )}

      {step === 'done' && (
        <main className="stack g24 rise" style={{ maxWidth: 640, margin: '0 auto', padding: '72px 24px' }}>
          <span style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--successbg)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={30} stroke={2.6} /></span>
          <h1 className="display" style={{ fontSize: 40 }}>{result?.autoApproved ? 'Refund approved. Sorry we let you down.' : 'Request received. We’re on it.'}</h1>
          <ol className="stack g12" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            <li className="row g12"><Icon name="check" color="var(--success)" stroke={2.6} />Request received · Ref #{result?.ref}</li>
            {result?.autoApproved
              ? <li className="row g12"><Icon name="check" color="var(--success)" stroke={2.6} />Approved automatically — the delivery window had passed</li>
              : <li className="row g12 muted"><span style={{ width: 18 }}>•</span>Our team replies within 24 hours on WhatsApp and email</li>}
            <li className="row g12 muted"><span style={{ width: 18 }}>•</span>{amount} back to your account in {PROMISES.refundDays}{result?.autoApproved ? '' : ' if approved'}</li>
          </ol>
          <Link to={`/me/orders/${id}`} className="btn btn-ink btn-lg" style={{ alignSelf: 'flex-start' }}>Back to my order</Link>
        </main>
      )}
    </>
  );
}
