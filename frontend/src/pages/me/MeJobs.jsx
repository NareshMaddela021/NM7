// Application tracker: Saved → Applied → Interview → Offer → Rejected, with follow-up reminders and simple stats.
import { useState } from 'react';
import { Dialog, useToast } from '../../components/ui';
import { useMe, setMe, newId, APP_STAGES } from '../../lib/customerStore';
import { BarChart, Kpi } from '../admin/AdminUI';
import { MeHead } from './MeLayout';
import { fmtShort, fmtDay } from './shared';

const DAY = 864e5;
const BLANK = { company: '', role: '', status: 'applied', url: '', notes: '', resumeId: '', next: '' };

function AppForm({ app, resumes, onSave, onDelete, onClose }) {
  const [f, setF] = useState({ ...BLANK, ...app, resumeId: app.resumeId || resumes[0].id, next: app.next ? new Date(app.next).toISOString().slice(0, 10) : '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog showTitle title={app.id ? `${app.company} · ${app.role}` : 'Add an application'} onClose={onClose}>
      <form className="stack g12" onSubmit={(e) => { e.preventDefault(); onSave({ ...f, next: f.next ? new Date(f.next).getTime() : null, date: app.date || Date.now(), id: app.id || newId('a') }); }}>
        <div className="row g8">
          <div className="field" style={{ flex: 1 }}><label htmlFor="ap-c" className="label">Company *</label><input id="ap-c" className="input" style={{ height: 42 }} value={f.company} onChange={set('company')} /></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="ap-r" className="label">Role *</label><input id="ap-r" className="input" style={{ height: 42 }} value={f.role} onChange={set('role')} /></div>
        </div>
        <div className="row g8">
          <div className="field" style={{ flex: 1 }}><label htmlFor="ap-s" className="label">Stage</label><select id="ap-s" className="input" style={{ height: 42 }} value={f.status} onChange={set('status')}>{APP_STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="ap-res" className="label">Resume sent</label><select id="ap-res" className="input" style={{ height: 42 }} value={f.resumeId} onChange={set('resumeId')}>{resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
        </div>
        <div className="row g8">
          <div className="field" style={{ flex: 2 }}><label htmlFor="ap-u" className="label">Job link · optional</label><input id="ap-u" className="input" style={{ height: 42 }} value={f.url} onChange={set('url')} placeholder="company.com/jobs/123" /></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="ap-n" className="label">Next step date</label><input id="ap-n" type="date" className="input" style={{ height: 42 }} value={f.next} onChange={set('next')} /></div>
        </div>
        <div className="field"><label htmlFor="ap-no" className="label">Notes</label><textarea id="ap-no" className="input" rows={3} value={f.notes} onChange={set('notes')} placeholder="Who referred you, interview rounds, salary discussed…" /></div>
        <div className="row g8">
          <button type="submit" className="btn btn-ink" disabled={!f.company.trim() || !f.role.trim()}>Save</button>
          {app.id && <button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={onDelete}>Delete</button>}
        </div>
      </form>
    </Dialog>
  );
}

export default function MeJobs() {
  const me = useMe();
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const apps = me.apps;
  const move = (a, dir) => { const i = APP_STAGES.findIndex(([k]) => k === a.status); const n = APP_STAGES[Math.min(APP_STAGES.length - 1, Math.max(0, i + dir))][0]; setMe((s) => ({ apps: s.apps.map((x) => (x.id === a.id ? { ...x, status: n } : x)) })); };
  const due = (a) => a.status === 'applied' && Date.now() - a.date > 7 * DAY && !a.followed;
  const sent = apps.filter((a) => a.status !== 'saved');
  const iv = apps.filter((a) => ['interview', 'offer'].includes(a.status)).length;
  const weeks = Array.from({ length: 6 }, (_, i) => { const end = Date.now() - (5 - i) * 7 * DAY; const start = end - 7 * DAY; return { label: i === 5 ? 'This wk' : fmtShort(start), sent: sent.filter((a) => a.date > start && a.date <= end).length }; });
  const resumeName = (id) => me.resumes.find((r) => r.id === id)?.name || '—';

  return (
    <>
      <MeHead title="Applications" sub="Track every job you apply to and which resume you sent." right={<button type="button" className="btn btn-ink" onClick={() => setEdit({})}>Add application</button>} />
      <div className="kpis">
        <Kpi label="Applied" value={sent.length} sub="excluding saved" />
        <Kpi label="Interview rate" value={sent.length ? `${Math.round((iv / sent.length) * 100)}%` : '—'} sub={`${iv} reached interview or offer`} />
        <Kpi label="Follow-ups due" value={apps.filter(due).length} sub="applied 7+ days ago" tone={apps.some(due) ? 'var(--warning)' : undefined} />
      </div>
      <div className="board" role="list" aria-label="Application board">
        {APP_STAGES.map(([k, l]) => {
          const col = apps.filter((a) => a.status === k);
          return (
            <section key={k} className="stack g8" role="listitem" aria-label={`${l}: ${col.length}`} style={{ background: 'var(--sunken)', borderRadius: 14, padding: 10, minHeight: 160 }}>
              <strong className="small row between"><span>{l}</span><span className="faint">{col.length}</span></strong>
              {col.map((a) => (
                <article key={a.id} className="card stack g4" style={{ padding: 12 }}>
                  <button type="button" className="link-btn" style={{ textAlign: 'left', fontWeight: 700, color: 'var(--text)', textDecoration: 'none' }} onClick={() => setEdit(a)}>{a.company}</button>
                  <span className="xs">{a.role}</span>
                  <span className="xs faint">{fmtDay(a.date)} · {resumeName(a.resumeId)}</span>
                  {a.next && <span className="xs" style={{ color: 'var(--text2)' }}>Next: {fmtShort(a.next)}</span>}
                  {due(a) && <span className="row g4 xs" style={{ color: 'var(--warning)' }}>⏰ Follow up? <button type="button" className="link-btn xs" onClick={() => { setMe((s) => ({ apps: s.apps.map((x) => (x.id === a.id ? { ...x, followed: Date.now(), notes: `${x.notes ? `${x.notes}\n` : ''}Followed up ${fmtDay(Date.now())}.` } : x)) })); toast('Marked as followed up'); }}>Done</button></span>}
                  <span className="row between" style={{ marginTop: 2 }}>
                    <button type="button" className="btn btn-icon" style={{ width: 30, height: 30, minHeight: 30 }} aria-label={`Move ${a.company} back`} disabled={k === APP_STAGES[0][0]} onClick={() => move(a, -1)}>←</button>
                    <button type="button" className="btn btn-icon" style={{ width: 30, height: 30, minHeight: 30 }} aria-label={`Move ${a.company} forward`} disabled={k === APP_STAGES[APP_STAGES.length - 1][0]} onClick={() => move(a, 1)}>→</button>
                  </span>
                </article>
              ))}
            </section>
          );
        })}
      </div>
      <section className="card"><BarChart title="Applications sent per week" data={weeks} series={[{ key: 'sent', label: 'Applications', color: 'var(--viz-1)' }]} height={150} /></section>
      {edit && <AppForm app={edit} resumes={me.resumes} onClose={() => setEdit(null)}
        onSave={(a) => { setMe((s) => ({ apps: s.apps.some((x) => x.id === a.id) ? s.apps.map((x) => (x.id === a.id ? a : x)) : [...s.apps, a] })); setEdit(null); toast('Saved'); }}
        onDelete={() => { setMe((s) => ({ apps: s.apps.filter((x) => x.id !== edit.id) })); setEdit(null); toast('Deleted'); }} />}
    </>
  );
}
