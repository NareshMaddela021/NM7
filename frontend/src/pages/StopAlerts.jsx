// /stop-alerts#t=…: the "Stop these emails" link in the resume health email (no sign-in needed). The token is in the
// address fragment, so it never reaches server logs; one tap confirms.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { http } from '../services/http';

const tokenOf = (hash) => (/(?:^#|&)t=([A-Za-z0-9._-]{10,200})/.exec(hash || '') || [])[1] || '';
const KINDS = {
  health: { title: 'Resume health emails', ask: 'Stop the emails about small fixes for your resume? The tips stay on your dashboard.', done: 'resume health emails', api: '/api/public/health/unsubscribe', where: <Link to="/me/settings">Settings</Link> },
  followups: { title: 'Follow-up reminder emails', ask: 'Stop the emails that remind you to follow up a week after you apply? The reminder still shows on My applications.', done: 'follow-up reminder emails', api: '/api/public/jobs/stop-followups', where: <Link to="/me/jobs">My applications</Link> },
  autoapply: { title: 'Auto Apply summary emails', ask: 'Stop the daily Auto Apply summary and the weekly report? Auto Apply keeps working; you can see everything on the Auto Apply page.', done: 'Auto Apply summary emails', api: '/api/public/auto-apply/stop-emails', where: <Link to="/me/auto-apply">Auto Apply</Link> },
  alerts: { title: 'Job alert emails', ask: 'Stop the emails with new jobs that match your alert? You can turn them back on any time.', done: 'job alert emails', api: '/api/public/jobs/stop-alerts', where: <Link to="/me/settings#job-alerts">Profile & settings</Link> },
  learn: { title: 'Learning path reminders', ask: 'Stop the weekly reminder about your unfinished learning path? Your progress stays on the Learning paths page.', done: 'learning path reminders', api: '/api/public/learn/stop-nudges', where: <Link to="/me/learn">Learning paths</Link> },
  interviews: { title: 'Interview reminder emails', ask: 'Stop the reminder emails the day before an interview? Interview invitations and changes still come.', done: 'interview reminder emails', api: '/api/public/interviews/stop-reminders', where: <Link to="/me/drive">My drive day</Link> },
};
const kindOf = (hash) => ((/(?:^#|&)k=(interviews|followups|alerts|autoapply|learn)(?:&|$)/.exec(hash || '') || [])[1] || 'health');

export default function StopAlerts() {
  const [token] = useState(() => tokenOf(typeof window !== 'undefined' ? window.location.hash : ''));
  const [k] = useState(() => KINDS[kindOf(typeof window !== 'undefined' ? window.location.hash : '')]);
  const [st, setSt] = useState({});
  const stop = async () => {
    setSt({ busy: true });
    try { await http(k.api, { method: 'POST', body: { token } }); setSt({ done: true }); } catch (e) { setSt({ error: e.message }); }
  };
  return (
    <>
      <Header />
      <main id="main" className="container stack g16" style={{ maxWidth: 560, padding: '48px 16px' }}>
        <h1 className="display h2">{k.title}</h1>
        {st.done ? (
          <p data-testid="stop-done">Done — you won’t get {k.done} any more. You can turn them back on in {k.where}.</p>
        ) : !token ? (
          <p>This link is incomplete. You can turn these emails off in {k.where}.</p>
        ) : (
          <>
            <p className="muted">{k.ask}</p>
            {st.error && <p role="alert" className="error">{st.error}</p>}
            <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={st.busy} onClick={stop} data-testid="stop-confirm">Stop these emails</button>
          </>
        )}
      </main>
    </>
  );
}
