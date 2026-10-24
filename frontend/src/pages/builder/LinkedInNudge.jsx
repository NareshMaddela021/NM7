// After a resume download in the builder: a small, dismissible "check your LinkedIn" prompt. Shown once per browser
// session after the first resume download; a tap on × hides it.
import { useState } from 'react';
import { Link } from 'react-router-dom';

const KEY = 'nm7.liNudge';
const seen = () => { try { return sessionStorage.getItem(KEY) === 'x'; } catch { return false; } };
const hide = () => { try { sessionStorage.setItem(KEY, 'x'); } catch { /* ignore */ } };

export default function LinkedInNudge({ show }) {
  const [closed, setClosed] = useState(seen);
  if (!show || closed) return null;
  const close = () => { hide(); setClosed(true); };
  return (
    <div className="card row between g8" role="status" data-testid="li-nudge" style={{ padding: '10px 14px', alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="small"><strong>Your resume is ready.</strong> <Link to="/linkedin" onClick={hide}>Check your LinkedIn for free</Link></span>
      <button type="button" className="link-btn" aria-label="Close" onClick={close} style={{ minWidth: 44, minHeight: 44, fontSize: 18 }}>×</button>
    </div>
  );
}
