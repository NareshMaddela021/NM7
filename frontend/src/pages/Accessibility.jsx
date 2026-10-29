// /accessibility — our accessibility statement: the standard we aim for, what we check and how, what we know isn't
// right yet, and how to tell us about a problem.
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import SiteFooter from '../components/SiteFooter';
import { usePageMeta } from '../lib/meta';

const UPDATED = '28 October 2026';

export default function Accessibility() {
  usePageMeta({ title: 'Accessibility', description: 'How Nm7 works for everyone: the standard we aim for, what we test and how to report a problem.', path: '/accessibility' });
  return (
    <>
      <Header />
      <main id="main" className="container stack g16" style={{ maxWidth: 760, padding: '32px 16px 64px' }}>
        <span className="mono xs muted">LAST UPDATED · {UPDATED.toUpperCase()}</span>
        <h1 className="display" style={{ fontSize: 34 }}>Accessibility</h1>
        <p className="lead" style={{ margin: 0 }}>We want every student, job seeker, college and recruiter to be able to use Nm7, including people who use a keyboard, a screen reader, zoom or a small phone.</p>
        <h2 style={{ fontSize: 20 }}>The standard we aim for</h2>
        <p>Web Content Accessibility Guidelines (WCAG) 2.1, level AA.</p>
        <h2 style={{ fontSize: 20 }}>What we do</h2>
        <ul>
          <li>Every page works with a keyboard alone, and the focused item is always outlined.</li>
          <li>Form fields have labels, images have text alternatives, and buttons have names a screen reader can read.</li>
          <li>Pop-up windows close with Escape, keep keyboard focus inside while open, and return focus to where you were.</li>
          <li>Text and controls meet AA contrast in both the light and the dark theme.</li>
          <li>Pages work on a 390 px wide phone, and at 200% zoom, without scrolling sideways.</li>
          <li>Automated accessibility checks (axe) run on our key pages with every change, in light and dark, on desktop and phone. Serious problems stop a release.</li>
        </ul>
        <h2 style={{ fontSize: 20 }}>What isn’t right yet</h2>
        <ul>
          <li>The resume preview in the builder is a picture of the printed page; the same text is in the form next to it, which is what screen readers should use.</li>
          <li>Telugu and Hindi pages are drafts until native speakers have reviewed them.</li>
          <li>Card payments open Razorpay’s own payment window, which we don’t control.</li>
        </ul>
        <h2 style={{ fontSize: 20 }}>Tell us about a problem</h2>
        <p>If something on Nm7 doesn’t work for you, please tell us through the <Link to="/contact">contact page</Link>, or from <strong>Help &amp; referral</strong> when you are signed in. Say which page and what you were trying to do. Our team replies by email within 24 hours, as for any support request.</p>
      </main>
      <SiteFooter />
    </>
  );
}
