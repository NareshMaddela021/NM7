// The recruiter pages' frame: the Nm7 mark, "My drives" once signed in to a recruiter account. Round P, Phase 3: a
// floating white pill header with a blue "Recruiter portal" chip, on the soft page glow.
import { Link } from 'react-router-dom';
import { readAccount } from '../../lib/recruiterPortal';
import '../../styles/me-kit.css';
import '../../styles/recruit.css';

export default function Shell({ children }) {
  return (
    <div className="rc-page">
      <header className="rc-top">
        <div className="rc-bar">
          <Link to="/" className="rc-logo" aria-label="Nm7 home">Nm<span>7</span></Link>
          <span className="rc-bar-right">
            <span className="rc-portal"><span className="rc-portal-dot" aria-hidden="true" />Recruiter portal · shared securely via Nm7</span>
            {readAccount() && <Link to="/recruiter/drives" className="btn btn-outline rc-drives-link">My drives</Link>}
          </span>
        </div>
      </header>
      <main id="main" className="rc-main stack g20">{children}</main>
    </div>
  );
}
