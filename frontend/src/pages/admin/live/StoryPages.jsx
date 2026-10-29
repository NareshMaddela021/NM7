// Admin → Stories: students' stories waiting for review. Approve (fixing typos only), or don't use. Demo stories
// are marked and never shown on the public site.
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { PageHead, Tabs } from '../AdminUI';
import { Loading, day, emptyIf, http, useAction, useApi } from './common';

export function LiveStories() {
  const toast = useToast();
  const [tab, setTab] = useState('pending');
  const st = useApi(`/api/admin/stories?status=${tab}`);
  const [busy, run] = useAction(toast);
  const [edit, setEdit] = useState({});
  const decide = (s, action) => run(async () => { await http(`/api/admin/stories/${s.id}`, { method: 'PUT', body: { action, ...(edit[s.id] !== undefined ? { story: edit[s.id] } : {}) } }); st.reload(); }, action === 'approve' ? 'Approved — it shows on the website' : 'Not used');
  return (
    <>
      <PageHead title="Stories" sub="Students’ stories for the home page and For organizations. Fix typos only; for anything bigger ask the student to send a new one. Students can withdraw a story any time." />
      <Tabs label="Show" tabs={[['pending', 'Waiting'], ['approved', 'On the website'], ['rejected', 'Not used']]} value={tab} onChange={setTab} />
      <Loading st={st} empty={emptyIf((d) => !d.length, 'Nothing here.')}>{(rows) => (
        <div className="stack g12">
          {rows.map((s) => (
            <article key={s.id} className="card stack g8" data-testid="admin-story">
              <span className="row between g8" style={{ flexWrap: 'wrap' }}><strong className="small">{s.displayName}{s.company ? ` · ${s.role ? `${s.role}, ` : ''}${s.company}` : ''}</strong><span className="row g8">{s.demo && <span className="badge b-neutral">Demo — never public</span>}{s.edited && <span className="badge b-neutral">Typos fixed</span>}<span className="xs muted">{day(s.createdAt)}</span></span></span>
              {s.photo && <img src={s.photo} alt={`Photo from ${s.displayName}`} width={56} height={56} style={{ borderRadius: '50%', objectFit: 'cover' }} />}
              <label className="sr-only" htmlFor={`as-${s.id}`}>Story text</label>
              <textarea id={`as-${s.id}`} className="input" rows={3} value={edit[s.id] ?? s.story} onChange={(e) => setEdit({ ...edit, [s.id]: e.target.value })} data-testid="admin-story-text" />
              {s.edited && <span className="xs muted">Sent as: “{s.original}”</span>}
              <div className="row g8">
                {s.status !== 'approved' && <button type="button" className="btn btn-ink" style={{ minHeight: 36 }} disabled={busy} onClick={() => decide(s, 'approve')} data-testid="admin-story-approve">Approve</button>}
                {s.status === 'approved' && edit[s.id] !== undefined && <button type="button" className="btn btn-ink" style={{ minHeight: 36 }} disabled={busy} onClick={() => decide(s, 'approve')}>Save typo fix</button>}
                {s.status !== 'rejected' && <button type="button" className="btn btn-outline" style={{ minHeight: 36 }} disabled={busy} onClick={() => decide(s, 'reject')} data-testid="admin-story-reject">{s.status === 'approved' ? 'Take down' : 'Don’t use'}</button>}
              </div>
            </article>
          ))}
        </div>
      )}</Loading>
    </>
  );
}
