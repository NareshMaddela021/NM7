// Footer with the policy links Razorpay and customers expect on every public page.
import { Link } from 'react-router-dom';
import { LEGAL } from '../lib/legal';
import { SOCIAL, SISTER_SITE } from '../lib/homeContent';

export default function SiteFooter() {
  return (
    <footer style={{ borderTop: '1px solid var(--border)' }}>
      <div className="container row between g12 small faint" style={{ padding: '24px', alignItems: 'flex-start' }}>
        <span className="stack g4"><span>Nm7 · nm7.si — a brand of {LEGAL.company} · Bengaluru</span><span style={{ userSelect: 'all' }}>{LEGAL.email}</span></span>
        <nav aria-label="Policies" className="row g16">
          <Link to="/contact">Contact us</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/refund-policy">Refunds & cancellation</Link>
          <Link to="/delivery-policy">Delivery</Link>
          <Link to="/expert-terms">Expert terms</Link>
        </nav>
        <span className="row g16">
          <a href={SISTER_SITE.url} target="_blank" rel="noreferrer" title={SISTER_SITE.blurb}>{SISTER_SITE.name} ↗</a>
          {Object.entries(SOCIAL).filter(([, u]) => u).map(([k, u]) => <a key={k} href={u} target="_blank" rel="noreferrer" style={{ textTransform: 'capitalize' }}>{k === 'x' ? 'X' : k}</a>)}
          <Link to="/signup?as=expert">Become an expert</Link><Link to="/login">Sign in</Link><Link to="/admin/login">Admin</Link></span>
      </div>
    </footer>
  );
}
