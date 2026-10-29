// The recruiter pages' frame: the Nm7 mark, "My drives" once signed in to a recruiter account.
import { Link } from 'react-router-dom';
import { readAccount } from '../../lib/recruiterPortal';

export default function Shell({ children }) {
  return (
    <>
      <header className="container-wide row between g8" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
        <Link to="/" className="display" style={{ fontSize: 20, textDecoration: 'none', color: 'inherit' }}>Nm<mark>7</mark></Link>
        <span className="row g12 xs muted">{readAccount() && <Link to="/recruiter/drives" className="small">My drives</Link>}<span>Recruiter portal · shared securely via Nm7</span></span>
      </header>
      <main id="main" className="container-wide stack g16" style={{ padding: '24px 16px 64px' }}>{children}</main>
    </>
  );
}
