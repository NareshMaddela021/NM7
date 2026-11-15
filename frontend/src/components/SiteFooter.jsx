// Footer with the policy links Razorpay and customers expect on every public page.
import { Link } from 'react-router-dom';
import { LEGAL } from '../lib/legal';
import { SOCIAL, SISTER_SITE } from '../lib/homeContent';
import { homeFor, useAuth } from '../lib/auth';
import { track } from '../lib/track';
import { useSalariesStatus } from '../lib/salaries';

export default function SiteFooter() {
  const { user } = useAuth();
  const salaries = useSalariesStatus(); // the salary guide's link shows only once it has enough data (round D1)
  return (
    <footer className="site-footer" lang="en" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="container row between g12 small faint" style={{ padding: '24px', alignItems: 'flex-start' }}>
        <span className="stack g4"><span>Nm7 · nm7.si — a brand of {LEGAL.company} · Bengaluru</span><a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a><span>Made in Bengaluru by AsuraaX AI</span></span>
        <nav aria-label="Site links" className="row g16">
          <Link to="/for-orgs" onClick={() => track('to_for_orgs')}>For organizations</Link>
          <Link to="/partners" onClick={() => track('to_partners')}>Partner programme</Link>
          <Link to="/for-companies">For companies: post jobs</Link>
          {salaries?.visible && <Link to="/salaries" data-testid="footer-salaries">Salary guide</Link>}
          <Link to="/blog">Blog</Link>
          <Link to="/contact">Contact us</Link>
          <Link to="/contact?topic=job-removal">Request job removal</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/refund-policy">Refunds & cancellation</Link>
          <Link to="/delivery-policy">Delivery</Link>
          <Link to="/expert-terms">Expert terms</Link>
          <Link to="/status">Status</Link>
          <Link to="/accessibility">Accessibility</Link>
        </nav>
        <span className="row g16">
          <a href={SISTER_SITE.url} target="_blank" rel="noreferrer" title={SISTER_SITE.blurb}>{SISTER_SITE.name} ↗</a>
          {Object.entries(SOCIAL).filter(([, u]) => u).map(([k, u]) => <a key={k} href={u} target="_blank" rel="noreferrer" style={{ textTransform: 'capitalize' }}>{k === 'x' ? 'X' : k}</a>)}
          <Link to="/signup?as=expert">Become an expert</Link>{user ? <Link to={homeFor(user)}>My dashboard</Link> : <Link to="/login">Sign in</Link>}</span>
      </div>
    </footer>
  );
}
