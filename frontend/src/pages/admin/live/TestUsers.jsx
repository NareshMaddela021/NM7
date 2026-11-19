// Admin → Settings → "Test users" (owner only): 100 made-up people for checking the live site with many different
// accounts. Create, open one (a one-time link signs this browser in as that person), remove. They are marked demo:
// left out of the numbers and the customers list, never emailed, never shown to a real company.
// Backend: backend/app/admin/test_users.py. All on the page, no pop-up dialogs.
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { Loading, http, useAction, useApi } from './common';

const KIND = { student: 'Student', fresher: 'Fresher', experienced: 'Experienced', senior: 'Senior' };
const RESUME = { none: 'No resume', started: 'Started', full: 'Complete' };

export function TestUsers() {
  const toast = useToast();
  const st = useApi('/api/admin/test-users');
  const [busy, run] = useAction(toast);
  const [ask, setAsk] = useState(false); // "Remove" asks once, on the page
  const create = () => run(async () => { await http('/api/admin/test-users', { method: 'POST' }); st.reload(); }, '100 test users are ready');
  const remove = () => run(async () => { await http('/api/admin/test-users', { method: 'DELETE' }); setAsk(false); st.reload(); }, 'Test users removed');
  const open = (n) => run(async () => { const r = await http(`/api/admin/test-users/${n}/open`, { method: 'POST' }); window.location.assign(r.path); });
  return (
    <section className="mcard as-sec" id="set-test-users" aria-label="Test users" data-testid="test-users">
      <header className="mcard-h"><span className="mcard-ic violet" aria-hidden="true">👥</span><span className="mcard-ht"><h2 className="mcard-title">Test users</h2></span></header>
      <span className="xs muted">100 made-up people for checking the site: students, freshers, experienced and senior people, with no resume, a started one or a complete one. Not counted in your numbers, never emailed, never shown to a real company, and they can’t apply to a real company’s job on Nm7. Opening one shows the site as that person; you stay signed in as admin and Back to Admin at the top brings you back.</span>
      <Loading st={st}>{(d) => (
        <div className="stack g8">
          <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <strong className="small" data-testid="test-users-count">{d.count === 0 ? 'No test users yet' : `${d.count} test users`}</strong>
            <button type="button" className="btn btn-signal" disabled={busy} onClick={create} data-testid="test-users-create">{d.count === 0 ? 'Create 100 test users' : 'Start fresh (create again)'}</button>
            {d.count > 0 && !ask && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setAsk(true)} data-testid="test-users-remove">Remove test users</button>}
          </div>
          {ask && (
            <div className="row g8 well" role="alert" style={{ flexWrap: 'wrap' }}>
              <span className="small">This removes all {d.count} test users and everything they made (resumes, applications, saved jobs).</span>
              <button type="button" className="btn btn-signal" disabled={busy} onClick={remove} data-testid="test-users-remove-confirm">Remove</button>
              <button type="button" className="link-btn small" onClick={() => setAsk(false)}>Cancel</button>
            </div>
          )}
          {d.count > 0 && (
            <div style={{ overflow: 'auto', maxHeight: 420 }}>
              <table className="table mtable"><thead><tr><th>No.</th><th>Name</th><th>Kind</th><th>Looking for</th><th>City</th><th>Resume</th><th /></tr></thead>
                <tbody>{d.users.map((u) => (
                  <tr key={u.id} data-testid="test-user-row">
                    <td className="small as-num" data-label="No.">{u.n}</td>
                    <td className="small">{u.name}{u.opened && <span className="badge b-neutral" style={{ marginLeft: 6 }}>Used</span>}</td>
                    <td className="small" data-label="Kind">{KIND[u.kind] || u.kind}{u.years > 0 ? `, ${u.years} yrs` : ''}</td>
                    <td className="small" data-label="Looking for">{u.role}</td>
                    <td className="small" data-label="City">{u.city}</td>
                    <td className="small" data-label="Resume">{RESUME[u.resume] || u.resume}</td>
                    <td><button type="button" className="btn btn-outline" style={{ minHeight: 32 }} disabled={busy} onClick={() => open(u.n)} data-testid="test-user-open">Open</button></td>
                  </tr>
                ))}</tbody></table>
            </div>
          )}
        </div>
      )}</Loading>
    </section>
  );
}
