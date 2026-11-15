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
import { Chip, Empty } from '../me/kit';
import '../../styles/me-kit.css';
import '../../styles/org-dashboard.css';

const REFRESH_MS = 30_000;
const BAND = [['low', 'Under 60', 'var(--danger)'], ['mid', '60–79', 'var(--warning)'], ['high', '80+', 'var(--success)']];
const TABS = ['notJoined', 'noResume', 'lowAts', 'notLinkedin', 'needsChanges', 'notPrinted'];
const pct = (n, of) => (of ? Math.round((100 * n) / of) : 0);
const ago = (ms) => {
  if (!ms) return '—';
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`;
};

/** One number widget (round P, Phase 4): a symbol, the label, the big number, the line under it and, where the data
 * gives a share, a small bar. `hero`: the four main numbers, bigger. */
function Tile({ label, value, sub, testid, icon, bar, bands, hero }) {
  return (
    <div className={`pld-tile ${hero ? 'pld-tile-hero' : ''}`} data-testid={testid}>
      <span className="pld-tile-top"><span className="pld-tile-ic" aria-hidden="true">{icon}</span><span className="pld-tile-label">{label}</span></span>
      <strong className="pld-tile-num">{value}</strong>
      {bar != null && <span className="pld-mini" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} /></span>}
      {bands && bands.n > 0 && (
        <span className="pld-mini pld-mini-bands" aria-hidden="true">
          {BAND.map(([k, , c]) => (bands[k] ? <span key={k} style={{ flex: `0 0 ${(bands[k] / bands.n) * 100}%`, background: c }} /> : null))}
        </span>
      )}
      {sub && <span className="pld-tile-sub">{sub}</span>}
    </div>
  );
}

const TILE_ICON = { 'pl-joined': '☺', 'pl-shared': '▤', 'pl-approved': '✓', 'pl-ats': '◎', 'pl-linkedin': 'in', 'pl-printed': '⎙', 'pl-shortlisted': '★', 'pl-applications': '✉', 'pl-placed': '🎓' };
const HERO = ['pl-joined', 'pl-shared', 'pl-applications', 'pl-placed'];
/** Small bars only from the numbers the server sent (no guessing). */
const tileBar = (id, t) => ({
  'pl-joined': t.invited ? pct(t.joined, t.invited) : null,
  'pl-shared': t.sharedPct,
  'pl-approved': t.ready ? pct(t.approved, t.ready) : null,
  'pl-linkedin': t.linkedinReadyPct,
  'pl-printed': t.ready ? pct(t.printed, t.ready) : null,
}[id] ?? null);

export function tiles(t) {
  return [
    ['pl-joined', 'Students joined', t.joined, t.invited !== null ? `of ${t.invited} on the roll list` : 'no roll list uploaded'],
    ['pl-shared', 'Resumes shared', `${t.sharedPct}%`, `${t.shared} of ${t.joined}`],
    ['pl-approved', 'Approved / ready', `${t.approved} / ${t.ready}`, 'approved members / marked Ready'],
    ['pl-ats', 'Average ATS score', t.atsAvg ?? '—', `${t.atsBands.low} under 60 · ${t.atsBands.mid} 60–79 · ${t.atsBands.high} 80+`],
    ['pl-linkedin', 'LinkedIn-ready', `${t.linkedinReadyPct}%`, `${t.linkedinReady} students: link added or check 70+`],
    ['pl-printed', 'Printed / ready', `${t.printed} / ${t.ready}`, t.readyNotPrinted ? `${t.readyNotPrinted} ready, not printed` : 'all ready resumes printed'],
    ['pl-shortlisted', 'Shortlisted by recruiters', t.shortlisted, 'by at least one company'],
    // Phase 4: real counts from the server (older servers leave them out, then the tiles are not shown)
    ...(t.applications != null ? [['pl-applications', 'Job applications', t.applications, 'sent on Nm7 by these students']] : []),
    ...(t.placed != null ? [['pl-placed', 'Placed', t.placed, `${pct(t.placed, t.joined)}% · full-time or PPO offer`]] : []),
  ];
}

function Funnel({ steps }) {
  const max = Math.max(1, steps[0]?.n || 0);
  return (
    <div className="stack g12" data-testid="pl-funnel">
      <span className="pld-card-h"><span className="pld-card-ic" aria-hidden="true">⏷</span><strong className="pld-card-title">Readiness funnel</strong></span>
      <ol className="pld-funnel">
        {steps.map((s, i) => (
          <li key={s.key} className="pld-step">
            <span className="pld-step-dot" aria-hidden="true">{i + 1}</span>
            <span className="pld-step-body">
              <span className="row between g8 xs"><strong className="small">{s.label}</strong><span className="mono pld-step-n">{s.n}{i > 0 && <span className="muted"> · {pct(s.n, steps[i - 1].n)}% of previous</span>}</span></span>
              <span className="pld-funnel-bar"><span style={{ width: `${Math.max(s.n ? 2 : 0, (s.n / max) * 100)}%` }} /></span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Bands({ rows, by }) {
  return (
    <div className="stack g12" data-testid="pl-bands">
      <span className="row between g8" style={{ flexWrap: 'wrap' }}>
        <span className="pld-card-h"><span className="pld-card-ic" aria-hidden="true">◎</span><strong className="pld-card-title">ATS score by {by}</strong></span>
        <span className="row g12 xs muted">{BAND.map(([k, l, c]) => <span key={k} className="row g4" style={{ alignItems: 'center' }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{l}</span>)}</span>
      </span>
      {rows.length === 0 && <Empty compact shape="resume" tint="college">No shared resumes yet.</Empty>}
      {rows.map((r) => (
        <div key={r.key} className="stack g4" title={`${r.key}: ${r.low} under 60, ${r.mid} 60–79, ${r.high} 80+`}>
          <div className="row between xs"><span>{r.key}</span><span className="mono muted">{r.n}</span></div>
          <div className="pld-bands-bar" aria-label={`${r.key}: ${r.low} under 60, ${r.mid} 60 to 79, ${r.high} 80 or more`} role="img">
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
      <span className="pld-card-h"><span className="pld-card-ic" aria-hidden="true">✦</span><strong className="pld-card-title">Skills across shared resumes</strong></span>
      {skills.length === 0 ? <span className="small muted">No skills yet.</span> : (
        <div className="pld-skills">
          {skills.map((s) => <span key={s.name} className="pld-skill" title={`${s.name}: ${s.n} students`} style={{ fontSize: 12 + Math.round((s.n / max) * 6), opacity: 0.7 + (s.n / max) * 0.3 }}>{s.name}<span className="pld-skill-n">{s.n}</span></span>)}
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
    <section className="mcard pld-roll" aria-label="Roll list" data-testid="pl-roll">
      <header className="mcard-h">
        <span className="mcard-ic" aria-hidden="true">☷</span>
        <span className="mcard-ht"><strong className="mcard-title">Roll list</strong><span className="mcard-sub">Upload a CSV with name, roll number, branch and email. Students are matched when they join (by email or roll number), so “Not joined” stays up to date. ID numbers (Aadhaar, PAN…) are refused.</span></span>
      </header>
      <div className="pld-roll-box">
        <label className="field pld-roll-field"><span className="label">Group</span>
          <select className="input" aria-label="Roll list group" value={gid} onChange={(e) => setGid(e.target.value)}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        </label>
        {st.data && <span className="pld-roll-count"><Chip tone={st.data.count ? 'ok' : 'neutral'}><span data-testid="pl-roll-count">{st.data.count ? `${st.data.count} students · ${st.data.joined} joined` : 'No roll list yet'}</span></Chip></span>}
      </div>
      {canManage && (
        <div className="pld-actions">
          <button type="button" className="btn btn-signal" disabled={busy || !gid} onClick={() => file.current?.click()}>{busy && <Spinner />}Upload CSV</button>
          {st.data?.count > 0 && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(async () => { await http(`${base}/groups/${gid}/roll-list`, { method: 'DELETE' }); st.reload(); onChange(); }, 'Roll list removed')}>Remove roll list</button>}
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
    <section className="mcard pld-missing" aria-label="Who’s missing" data-testid="pl-missing">
      <header className="mcard-h">
        <span className="mcard-ic" aria-hidden="true">⚑</span>
        <span className="mcard-ht"><strong className="mcard-title">Who’s missing</strong><span className="mcard-sub">Pick a list, tick students and act on them together.</span></span>
      </header>
      <div className="pld-tabs" role="tablist" aria-label="Who’s missing">
        {TABS.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className="pld-tab" onClick={() => setTab(k)}>{d.listTitles[k]} <span className="pld-tab-n">{d.lists[k].length}</span></button>)}
      </div>
      <div className="pld-toolbar" role="group" aria-label="Actions on this list">
        {!viewer && <button type="button" className="btn btn-signal" disabled={busy || !sel.length} onClick={() => setDialog('remind')}>Send reminder{sel.length ? ` (${sel.length})` : ''}</button>}
        {!viewer && tab !== 'notJoined' && tab !== 'noResume' && <button type="button" className="btn btn-outline" disabled={busy || !sel.length} onClick={() => setDialog('changes')}>Mark needs changes</button>}
        {!viewer && wa && <button type="button" className="btn btn-outline" disabled={busy || !sel.length} onClick={() => setDialog('wa')} data-testid="pl-wa">WhatsApp / SMS{sel.length ? ` (${sel.length})` : ''}</button>}
        {!viewer && <button type="button" className="btn btn-outline pld-export" disabled={busy || !rows.length} onClick={csv}><span aria-hidden="true">⤓ </span>Download CSV</button>}
        {tab === 'notJoined' && <span className="pld-toolbar-note">They haven’t joined, so they can’t be emailed from here: share the group’s join link or QR code with them.</span>}
      </div>
      {rows.length === 0 ? <div data-testid="pl-missing-empty"><Empty compact shape="college" tint="college" title="No one here. 🎉">Everyone in this list is done.</Empty></div> : (
        <div className="table-wrap mtable-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table mtable pld-table" data-testid="pl-missing-table">
          <thead><tr>
            {tab !== 'notJoined' && !viewer && <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? [] : selectable.map((r) => r.membershipId))} /></th>}
            <th>Name</th><th>Roll no.</th><th>Branch</th><th>What’s missing</th><th>Last active</th>
          </tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={r.membershipId || `${r.roll}-${i}`} className={sel.includes(r.membershipId) ? 'pld-sel' : ''}>
              {tab !== 'notJoined' && !viewer && <td className="pld-check"><input type="checkbox" aria-label={`Select ${r.name}`} checked={sel.includes(r.membershipId)} onChange={() => setSel(sel.includes(r.membershipId) ? sel.filter((x) => x !== r.membershipId) : [...sel, r.membershipId])} /></td>}
              <td className="small pld-name" data-label="Name"><span className="pld-who"><span className="pld-av" aria-hidden="true">{(r.name || '?').trim().charAt(0).toUpperCase()}</span><span className="stack">{r.name || '—'}<span className="xs faint">{r.group}</span></span></span></td>
              <td className="small mono" data-label="Roll no.">{r.roll || '—'}</td>
              <td className="small" data-label="Branch">{r.branch || '—'}</td>
              <td className="small" data-label="What’s missing">{r.missing.join(' · ')}{r.ats !== null && r.ats !== undefined && tab === 'lowAts' && <span className="xs faint"> · ATS {r.ats}</span>}</td>
              <td className="small" data-label="Last active">{ago(r.lastActive)}</td>
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
            <div className="row g8"><button type="button" className="btn btn-signal" disabled={busy || (dialog === 'changes' && !note.trim())} onClick={send}>{busy && <Spinner />}{dialog === 'remind' ? 'Send' : 'Mark needs changes'}</button><button type="button" className="btn btn-outline" onClick={() => setDialog(null)}>Cancel</button></div>
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
  if (st.error) return <div className="mcard mcard-bad" role="alert">{st.error.message}</div>;
  if (!d) return <div className="pld-loading" role="status" aria-label="Loading"><Spinner /> Loading…<span className="pld-skel" aria-hidden="true"><span /><span /><span /><span /></span></div>;
  const weekly = d.weekly?.map((w) => ({ label: new Date(`${w.week}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), joined: w.joined, updated: w.updated, ready: w.ready }));
  const all = tiles(d.tiles);
  const tile = ([id, label, value, sub]) => <Tile key={id} testid={id} label={label} value={value} sub={sub} icon={TILE_ICON[id]} bar={tileBar(id, d.tiles)} bands={id === 'pl-ats' ? { ...d.tiles.atsBands, n: d.tiles.atsBands.low + d.tiles.atsBands.mid + d.tiles.atsBands.high } : null} hero={HERO.includes(id)} />;
  return (
    <div className="stack g16 pld" data-testid="placement">
      <div className="mcard mcard-accent pld-head">
        <span className="pld-head-text">
          <strong className="pld-title">Placement dashboard</strong>
          <span className="pld-live"><span className="pld-live-dot" aria-hidden="true" />Live: refreshes every 30 seconds · only students who joined and agreed to share</span>
        </span>
        <label className="field pld-show"><span className="label">Showing</span>
          <select className="input" aria-label="Show" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">Whole organization</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
      </div>
      <div className="pld-hero">{all.filter(([id]) => HERO.includes(id)).map(tile)}</div>
      <div className="pld-more">{all.filter(([id]) => !HERO.includes(id)).map(tile)}</div>
      {!d.insights ? (
        <div className="mcard mcard-accent pld-upgrade" data-testid="pl-upgrade">
          <span className="pld-upgrade-ic" aria-hidden="true">✦</span>
          <span className="stack g8">
            <strong className="pld-card-title">Charts, who’s-missing lists, reminders and roll lists</strong>
            <span className="small muted">See who hasn’t joined, who has no resume or a low ATS score, remind them in one click and track weekly progress. These are in the Drive and Campus plans.</span>
            {billingUrl ? <Link className="btn btn-signal" style={{ alignSelf: 'flex-start' }} to={billingUrl}>See plans</Link> : <span className="xs muted">Ask your organization’s Owner to upgrade.</span>}
          </span>
        </div>
      ) : (
        <>
          <div className="pld-grid">
            <div className="mcard pld-card"><Funnel steps={d.funnel} /></div>
            <div className="mcard pld-card"><Bands rows={d.atsByBranch} by={d.atsBy} /></div>
            <div className="mcard pld-card" data-testid="pl-gaps">
              <span className="pld-card-h"><span className="pld-card-ic" aria-hidden="true">!</span><span className="pld-card-title">What resumes miss most</span></span>
              <HBars title="Top missing items (% of shared resumes)" rows={d.topMissing.slice(0, 8).map((m) => ({ label: `${m.pct}% ${m.text}`, value: m.pct }))} fmt={(v) => `${v}%`} color="var(--warning)" />
              {d.topMissing.length === 0 && <span className="small muted">Nothing missing across shared resumes.</span>}
            </div>
            <div className="mcard pld-card"><Skills skills={d.skills} /></div>
          </div>
          <div className="mcard pld-card" data-testid="pl-weekly">
            <BarChart title="Weekly progress (last 8 weeks)" data={weekly} series={[{ key: 'joined', label: 'Joined', color: '#0d9488' }, { key: 'updated', label: 'Updated a resume', color: 'var(--viz-2)' }, { key: 'ready', label: 'Marked Ready', color: 'var(--viz-3)' }]} height={160} />
          </div>
          <MissingTabs base={base} d={d} group={group} role={role} onChange={reload} wa={wa} />
          {groups.length > 0 && <RollList base={base} groups={groups} canManage={canManage && role !== 'viewer'} onChange={reload} />}
        </>
      )}
    </div>
  );
}
