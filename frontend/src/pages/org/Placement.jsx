// Placement dashboard (Org > Dashboard): tiles for every plan; on Drive / Campus the readiness funnel, ATS bands by
// branch, top missing items, skills cloud, weekly progress, "who's missing" tabs with bulk actions (reminder, mark
// needs changes, CSV) and the roll list upload. The server decides what this viewer may see (their organization,
// their groups, consenting members only) and what the plan includes; this page only arranges it. It refreshes every
// 30 seconds while open, so students' edits show up without a reload.
import WaReminders from './WaReminders';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, Spinner, useToast } from '../../components/ui';
import { fileName } from '../../lib/fileName';
import { API_BASE } from '../../services/http';
import { savePdf } from '../builder/resumePdf';
import { BarChart, HBars } from '../admin/AdminUI';
import { http, useAction, useApi } from '../admin/live/common';

const REFRESH_MS = 30_000;
const BAND = [['low', 'Under 60', 'var(--danger)'], ['mid', '60–79', 'var(--warning)'], ['high', '80+', 'var(--success)']];
const TABS = ['notJoined', 'noResume', 'lowAts', 'notLinkedin', 'needsChanges', 'notPrinted'];
const pct = (n, of) => (of ? Math.round((100 * n) / of) : 0);
const ago = (ms) => {
  if (!ms) return '—';
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`;
};

function Tile({ label, value, sub, testid }) {
  return (
    <div className="card stack g4" style={{ padding: 14 }} data-testid={testid}>
      <span className="xs muted">{label}</span>
      <strong className="display" style={{ fontSize: 26 }}>{value}</strong>
      {sub && <span className="xs faint">{sub}</span>}
    </div>
  );
}

export function tiles(t) {
  return [
    ['pl-joined', 'Students joined', t.joined, t.invited !== null ? `of ${t.invited} on the roll list` : 'no roll list uploaded'],
    ['pl-shared', 'Resumes shared', `${t.sharedPct}%`, `${t.shared} of ${t.joined}`],
    ['pl-approved', 'Approved / ready', `${t.approved} / ${t.ready}`, 'approved members / marked Ready'],
    ['pl-ats', 'Average ATS score', t.atsAvg ?? '—', `${t.atsBands.low} under 60 · ${t.atsBands.mid} 60–79 · ${t.atsBands.high} 80+`],
    ['pl-linkedin', 'LinkedIn-ready', `${t.linkedinReadyPct}%`, `${t.linkedinReady} students: link added or check 70+`],
    ['pl-printed', 'Printed / ready', `${t.printed} / ${t.ready}`, t.readyNotPrinted ? `${t.readyNotPrinted} ready, not printed` : 'all ready resumes printed'],
    ['pl-shortlisted', 'Shortlisted by recruiters', t.shortlisted, 'by at least one company'],
  ];
}

function Funnel({ steps }) {
  const max = Math.max(1, steps[0]?.n || 0);
  return (
    <div className="stack g12" data-testid="pl-funnel">
      <strong className="small">Readiness funnel</strong>
      {steps.map((s, i) => (
        <div key={s.key} className="stack g4">
          <div className="row between xs"><strong>{s.label}</strong><span className="mono">{s.n}{i > 0 && <span className="muted"> · {pct(s.n, steps[i - 1].n)}% of previous</span>}</span></div>
          <div style={{ height: 14, borderRadius: 4, background: 'var(--sunken)' }}><div style={{ height: 14, borderRadius: 4, width: `${Math.max(s.n ? 2 : 0, (s.n / max) * 100)}%`, background: 'var(--viz-1)' }} /></div>
        </div>
      ))}
    </div>
  );
}

function Bands({ rows, by }) {
  return (
    <div className="stack g12" data-testid="pl-bands">
      <span className="row between g8" style={{ flexWrap: 'wrap' }}>
        <strong className="small">ATS score by {by}</strong>
        <span className="row g12 xs muted">{BAND.map(([k, l, c]) => <span key={k} className="row g4" style={{ alignItems: 'center' }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{l}</span>)}</span>
      </span>
      {rows.length === 0 && <span className="small muted">No shared resumes yet.</span>}
      {rows.map((r) => (
        <div key={r.key} className="stack g4" title={`${r.key}: ${r.low} under 60, ${r.mid} 60–79, ${r.high} 80+`}>
          <div className="row between xs"><span>{r.key}</span><span className="mono muted">{r.n}</span></div>
          <div style={{ display: 'flex', alignItems: 'stretch', height: 10, borderRadius: 4, overflow: 'hidden', gap: 2, background: 'var(--sunken)' }} aria-label={`${r.key}: ${r.low} under 60, ${r.mid} 60 to 79, ${r.high} 80 or more`} role="img">
            {BAND.map(([k, , c]) => (r[k] ? <span key={k} style={{ display: 'block', height: '100%', flex: `0 0 ${(r[k] / r.n) * 100}%`, background: c }} /> : null))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Skills({ skills }) {
  const max = Math.max(1, ...skills.map((s) => s.n));
  return (
    <div className="stack g8" data-testid="pl-skills">
      <strong className="small">Skills across shared resumes</strong>
      {skills.length === 0 ? <span className="small muted">No skills yet.</span> : (
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          {skills.map((s) => <span key={s.name} className="badge b-neutral" title={`${s.name}: ${s.n} students`} style={{ fontSize: 11 + Math.round((s.n / max) * 7), padding: '4px 10px' }}>{s.name}<span className="faint" style={{ marginLeft: 6 }}>{s.n}</span></span>)}
        </div>
      )}
    </div>
  );
}

function RollList({ base, groups, canManage, onChange }) {
  const toast = useToast();
  const [gid, setGid] = useState(groups[0]?.id || '');
  const st = useApi(gid ? `${base}/groups/${gid}/roll-list` : null);
  const [busy, run] = useAction(toast);
  const file = useRef(null);
  const upload = async (f) => {
    if (!f) return;
    const text = await f.text();
    run(async () => { await http(`${base}/groups/${gid}/roll-list`, { method: 'PUT', body: { csv: text } }); st.reload(); onChange(); }, 'Roll list uploaded');
  };
  return (
    <section className="card stack g8" aria-label="Roll list" data-testid="pl-roll">
      <strong>Roll list</strong>
      <span className="xs muted">Upload a CSV with name, roll number, branch and email. Students are matched when they join (by email or roll number), so “Not joined” stays up to date. ID numbers (Aadhaar, PAN…) are refused.</span>
      <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="input" aria-label="Roll list group" style={{ height: 40, width: 'auto', maxWidth: '100%' }} value={gid} onChange={(e) => setGid(e.target.value)}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        {st.data && <span className="small" data-testid="pl-roll-count">{st.data.count ? `${st.data.count} students · ${st.data.joined} joined` : 'No roll list yet'}</span>}
      </div>
      {canManage && (
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" disabled={busy || !gid} onClick={() => file.current?.click()}>{busy && <Spinner />}Upload CSV</button>
          {st.data?.count > 0 && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run(async () => { await http(`${base}/groups/${gid}/roll-list`, { method: 'DELETE' }); st.reload(); onChange(); }, 'Roll list removed')}>Remove roll list</button>}
          <input ref={file} type="file" accept=".csv,text/csv" hidden aria-label="Roll list CSV" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      )}
    </section>
  );
}

function MissingTabs({ base, d, group, role, onChange, wa }) {
  const toast = useToast();
  const [tab, setTab] = useState('noResume');
  const [sel, setSel] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [note, setNote] = useState('');
  const [busy, run] = useAction(toast);
  const rows = d.lists[tab] || [];
  const viewer = role === 'viewer';
  useEffect(() => setSel([]), [tab, group]);
  const selectable = rows.filter((r) => r.membershipId);
  const all = selectable.length > 0 && selectable.every((r) => sel.includes(r.membershipId));
  const csv = () => run(async () => {
    const q = new URLSearchParams({ list: tab, ...(group ? { group } : {}) });
    const res = await fetch(`${API_BASE}${base}/placement/missing.csv?${q}`, { credentials: 'include' });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message || 'The CSV couldn’t be made.');
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // the server's IST day
    await savePdf(await res.blob(), fileName([d.listTitles[tab].split(' (')[0], day], 'csv'));
  }, 'CSV downloaded');
  const send = () => run(async () => {
    if (dialog === 'remind') {
      const r = await http(`${base}/placement/remind`, { method: 'POST', body: { ids: sel, note } });
      toast(`${r.sent} reminder${r.sent === 1 ? '' : 's'} sent${r.skipped ? ` · ${r.skipped} skipped (reminded today, opted out or demo)` : ''}`);
    } else {
      const r = await http(`${base}/shared-resumes/review`, { method: 'POST', body: { ids: sel, status: 'needs_changes', note } });
      toast(`${r.updated} marked “Needs changes”${r.emailed ? ` · ${r.emailed} emailed` : ''}`);
    }
    setDialog(null); setNote(''); setSel([]); onChange();
  });
  return (
    <section className="card stack g12" aria-label="Who’s missing" data-testid="pl-missing">
      <strong>Who’s missing</strong>
      <div className="row g4" role="tablist" aria-label="Who’s missing" style={{ flexWrap: 'wrap' }}>
        {TABS.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn ${tab === k ? 'btn-ink' : 'btn-outline'}`} style={{ minHeight: 36 }} onClick={() => setTab(k)}>{d.listTitles[k]} <span className="mono" style={{ marginLeft: 4 }}>{d.lists[k].length}</span></button>)}
      </div>
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        {!viewer && <button type="button" className="btn btn-outline" disabled={busy || !sel.length} onClick={() => setDialog('remind')}>Send reminder{sel.length ? ` (${sel.length})` : ''}</button>}
        {!viewer && tab !== 'notJoined' && tab !== 'noResume' && <button type="button" className="btn btn-outline" disabled={busy || !sel.length} onClick={() => setDialog('changes')}>Mark needs changes</button>}
        {!viewer && wa && <button type="button" className="btn btn-outline" disabled={busy || !sel.length} onClick={() => setDialog('wa')} data-testid="pl-wa">WhatsApp / SMS{sel.length ? ` (${sel.length})` : ''}</button>}
        {!viewer && <button type="button" className="btn btn-outline" disabled={busy || !rows.length} onClick={csv}>Download CSV</button>}
        {tab === 'notJoined' && <span className="xs muted" style={{ alignSelf: 'center' }}>They haven’t joined, so they can’t be emailed from here: share the group’s join link or QR code with them.</span>}
      </div>
      {rows.length === 0 ? <span className="small muted" data-testid="pl-missing-empty">No one here. 🎉</span> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table" data-testid="pl-missing-table">
          <thead><tr>
            {tab !== 'notJoined' && !viewer && <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? [] : selectable.map((r) => r.membershipId))} /></th>}
            <th>Name</th><th>Roll no.</th><th>Branch</th><th>What’s missing</th><th>Last active</th>
          </tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={r.membershipId || `${r.roll}-${i}`}>
              {tab !== 'notJoined' && !viewer && <td><input type="checkbox" aria-label={`Select ${r.name}`} checked={sel.includes(r.membershipId)} onChange={() => setSel(sel.includes(r.membershipId) ? sel.filter((x) => x !== r.membershipId) : [...sel, r.membershipId])} /></td>}
              <td className="small">{r.name || '—'}<div className="xs faint">{r.group}</div></td>
              <td className="small mono">{r.roll || '—'}</td>
              <td className="small">{r.branch || '—'}</td>
              <td className="small">{r.missing.join(' · ')}{r.ats !== null && r.ats !== undefined && tab === 'lowAts' && <span className="xs faint"> · ATS {r.ats}</span>}</td>
              <td className="small">{ago(r.lastActive)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {dialog === 'wa' && <WaReminders base={base} ids={sel} list={tab} defaultMessage={`Hi {name}, a reminder from the placement office: ${(d.listTitles[tab] || '').split(' (')[0].toLowerCase()} — please update your resume on Nm7 today.`} onClose={() => { setDialog(null); setSel([]); }} />}
      {dialog && dialog !== 'wa' && (
        <Dialog title={dialog === 'remind' ? `Send a reminder to ${sel.length}` : `Mark ${sel.length} as needs changes`} onClose={() => setDialog(null)}>
          <div className="stack g12">
            <span className="small muted">{dialog === 'remind' ? 'One email per student per day; students who opted out are skipped. The email lists what their resume is missing.' : 'They get an email with your note, and see it in My groups.'}</span>
            <div className="field"><label className="label" htmlFor="pl-note">{dialog === 'remind' ? 'Note (optional)' : 'What needs to change'}</label><textarea id="pl-note" className="input" rows={3} maxLength={dialog === 'remind' ? 300 : 500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <div className="row g8"><button type="button" className="btn btn-ink" disabled={busy || (dialog === 'changes' && !note.trim())} onClick={send}>{busy && <Spinner />}{dialog === 'remind' ? 'Send' : 'Mark needs changes'}</button><button type="button" className="btn btn-outline" onClick={() => setDialog(null)}>Cancel</button></div>
          </div>
        </Dialog>
      )}
    </section>
  );
}

/**
 * The placement dashboard. `base`: /api/org/<id> (staff or Nm7). `billingUrl`: where an Owner upgrades (portal only).
 */
export default function Placement({ base, role, canManage, billingUrl, wa }) {
  const [group, setGroup] = useState('');
  const url = `${base}/placement${group ? `?group=${encodeURIComponent(group)}` : ''}`;
  const st = useApi(url);
  const { reload } = st;
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') reload(); };
    const id = setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = st.data;
  const groups = useMemo(() => d?.groups || [], [d]);
  if (st.error) return <div className="card" role="alert">{st.error.message}</div>;
  if (!d) return <div className="row g12 muted" role="status"><Spinner /> Loading…</div>;
  const weekly = d.weekly?.map((w) => ({ label: new Date(`${w.week}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), joined: w.joined, updated: w.updated, ready: w.ready }));
  return (
    <div className="stack g16" data-testid="placement">
      <div className="row between g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="stack g4"><strong style={{ fontSize: 20 }}>Placement dashboard</strong><span className="xs muted">Live: refreshes every 30 seconds · only students who joined and agreed to share</span></div>
        <select className="input" aria-label="Show" style={{ height: 40, width: 'auto', maxWidth: '100%' }} value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">Whole organization</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        {tiles(d.tiles).map(([id, label, value, sub]) => <Tile key={id} testid={id} label={label} value={value} sub={sub} />)}
      </div>
      {!d.insights ? (
        <div className="well stack g8" data-testid="pl-upgrade">
          <strong className="small">Charts, who’s-missing lists, reminders and roll lists</strong>
          <span className="small muted">See who hasn’t joined, who has no resume or a low ATS score, remind them in one click and track weekly progress. These are in the Drive and Campus plans.</span>
          {billingUrl ? <Link className="btn btn-ink" style={{ alignSelf: 'flex-start' }} to={billingUrl}>See plans</Link> : <span className="xs muted">Ask your organization’s Owner to upgrade.</span>}
        </div>
      ) : (
        <>
          <div className="row g16" style={{ alignItems: 'stretch', flexWrap: 'wrap' }}>
            <div className="card" style={{ flex: '1 1 300px', padding: 16, minWidth: 0 }}><Funnel steps={d.funnel} /></div>
            <div className="card" style={{ flex: '1 1 300px', padding: 16, minWidth: 0 }}><Bands rows={d.atsByBranch} by={d.atsBy} /></div>
          </div>
          <div className="row g16" style={{ alignItems: 'stretch', flexWrap: 'wrap' }}>
            <div className="card stack g8" style={{ flex: '1 1 300px', padding: 16, minWidth: 0 }} data-testid="pl-gaps">
              <HBars title="Top missing items (% of shared resumes)" rows={d.topMissing.slice(0, 8).map((m) => ({ label: `${m.pct}% ${m.text}`, value: m.pct }))} fmt={(v) => `${v}%`} />
              {d.topMissing.length === 0 && <span className="small muted">Nothing missing across shared resumes.</span>}
            </div>
            <div className="card" style={{ flex: '1 1 300px', padding: 16, minWidth: 0 }}><Skills skills={d.skills} /></div>
          </div>
          <div className="card" style={{ padding: 16, minWidth: 0 }} data-testid="pl-weekly">
            <BarChart title="Weekly progress (last 8 weeks)" data={weekly} series={[{ key: 'joined', label: 'Joined', color: 'var(--viz-1)' }, { key: 'updated', label: 'Updated a resume', color: 'var(--viz-2)' }, { key: 'ready', label: 'Marked Ready', color: 'var(--viz-3)' }]} height={160} />
          </div>
          <MissingTabs base={base} d={d} group={group} role={role} onChange={reload} wa={wa} />
          {groups.length > 0 && <RollList base={base} groups={groups} canManage={canManage && role !== 'viewer'} onChange={reload} />}
        </>
      )}
    </div>
  );
}
