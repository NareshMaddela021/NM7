// /partners — the Nm7 partner programme: how it works and the application form (name, organisation, email, phone —
// nothing else: no PAN or bank details until the first payout). Nm7 approves each application and emails a code.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header';
import SiteFooter from '../../components/SiteFooter';
import { LIVE } from '../../lib/auth';
import { usePageMeta } from '../../lib/meta';
import { http } from '../../services/http';

const DEFAULT_TERMS = { commissionPct: 20, commissionMonths: 12, payableDays: 30, referralDays: 90 };

function Apply() {
  const [f, setF] = useState({ name: '', organisation: '', email: '', phone: '' });
  const [st, setSt] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setSt({ busy: true });
    try { await http('/api/public/partners/apply', { method: 'POST', body: f }); setSt({ done: true }); } catch (err) { setSt({ error: err.message }); }
  };
  if (st.done) return <p className="well small" role="status">Thank you — we’ve got your application and emailed you. Once it’s approved you’ll get your partner code and link by email.</p>;
  return (
    <form className="stack g12" aria-label="Partner application" onSubmit={submit}>
      <div className="row g12" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 240px' }}><label className="label" htmlFor="pa-n">Your name</label><input id="pa-n" className="input" required minLength={2} maxLength={80} autoComplete="name" value={f.name} onChange={set('name')} /></div>
        <div className="field" style={{ flex: '1 1 240px' }}><label className="label" htmlFor="pa-o">Organisation (optional)</label><input id="pa-o" className="input" maxLength={120} autoComplete="organization" value={f.organisation} onChange={set('organisation')} /></div>
      </div>
      <div className="row g12" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 240px' }}><label className="label" htmlFor="pa-e">Email</label><input id="pa-e" type="email" className="input" required autoComplete="email" value={f.email} onChange={set('email')} /></div>
        <div className="field" style={{ flex: '1 1 240px' }}><label className="label" htmlFor="pa-p">Phone</label><input id="pa-p" type="tel" className="input" required minLength={8} maxLength={20} pattern="[0-9+\- ()]+" autoComplete="tel" value={f.phone} onChange={set('phone')} /></div>
      </div>
      <span className="xs muted">That’s all we need now. We never ask for PAN or bank details until your first payout.</span>
      <button type="submit" className="btn btn-ink btn-lg" style={{ alignSelf: 'flex-start' }} disabled={st.busy}>{st.busy ? 'Sending…' : 'Apply to be a partner'}</button>
      {st.error && <p className="small" role="alert" style={{ color: 'var(--danger)' }}>{st.error}</p>}
    </form>
  );
}

export default function Partners() {
  usePageMeta({ title: 'Nm7 partner programme — earn by bringing colleges and job fairs', description: 'Refer colleges, training institutes and job fairs to Nm7 for Organizations and earn commission on their plans. Apply in a minute.', path: '/partners' });
  const [t, setT] = useState(DEFAULT_TERMS);
  useEffect(() => { if (LIVE) http('/api/public/partner-terms').then(setT, () => {}); }, []);
  return (
    <>
      <Header />
      <main id="main" className="container stack g24" style={{ maxWidth: 820, padding: '32px 16px 64px' }}>
        <section className="stack g12">
          <span className="xs muted">Nm7 partner programme</span>
          <h1 className="display" style={{ fontSize: 'clamp(28px, 6vw, 40px)' }}>Bring organizations to Nm7, earn on every plan</h1>
          <p className="muted">For placement consultants, trainers and anyone who works with colleges, training institutes or job fairs. Share your link; when an organization you referred buys a plan on <Link to="/for-orgs">Nm7 for Organizations</Link>, you earn commission.</p>
        </section>
        <section className="card stack g8" aria-labelledby="how-h">
          <h2 id="how-h" className="display h3">How it works</h2>
          <ol className="small stack g6" style={{ paddingLeft: 20 }}>
            <li>Apply below. We approve you and email your partner code (like <span className="mono">ASX-RAVI</span>) and your link.</li>
            <li>Share the link. We remember it for {t.referralDays} days, and organizations can also type your code at checkout.</li>
            <li>An organization is credited to you at its first payment. You earn <strong>{t.commissionPct}%</strong> of the plan price (before GST) on every payment it makes in its first {t.commissionMonths} months.</li>
            <li>Commission becomes payable {t.payableDays} days after each payment. If a payment is refunded, its commission is reversed.</li>
            <li>Follow your referred organizations and commission on your partner page. You see each organization’s name and plan — never its members or their resumes.</li>
          </ol>
        </section>
        <section className="card stack g12" aria-labelledby="apply-h">
          <h2 id="apply-h" className="display h3">Apply</h2>
          <Apply />
          <span className="xs muted">Already a partner? <Link to="/partner">Open your partner page</Link>.</span>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
