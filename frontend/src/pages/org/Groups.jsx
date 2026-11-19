// Nm7 for Organizations, the member side: /join/:code (what a group's QR code or link opens) and /me/groups.
// Joining = consent + the group's questions + which resume to share. Leaving removes the resume from the
// organization's view at once.
import Marks from './Marks';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Header from '../../components/Header';
import SiteFooter from '../../components/SiteFooter';
import { Spinner, useToast } from '../../components/ui';
import { LIVE, useAuth } from '../../lib/auth';
import { blankResume, reloadMe } from '../../lib/customerStore';
import { createResume, flush } from '../../lib/meLive';
import { usePageMeta } from '../../lib/meta';
import { http } from '../../services/http';
import { MeHead } from '../me/MeLayout';
import { fmtDay } from '../me/shared';
import { memberStatus, staffSummary } from '../../lib/orgDashboard';
import { brandDesign } from '../../lib/branding';
import { brandFor, checklist } from '../../lib/placementFormat';
import ResumePreview from '../builder/ResumePreview';
import ErrorBoundary from '../../components/ErrorBoundary';
import MyInterviews from '../../components/MyInterviews';
import { Chip, Empty, Skel } from '../me/kit';
import '../../styles/me-account.css';
import '../../styles/org-groups.css';
import { Still } from '../newhome/ParticleStage';
import { IcAlert, IcBuilding, IcCalendar, IcCap, IcCheck, IcFlag, IcGlobe, IcLock, IcStar } from '../../components/icons';

const chipTone = (cls = '') => ({ 'b-success': 'ok', 'b-warning': 'warn', 'b-danger': 'bad', 'b-signal': 'accent' }[cls] || 'neutral');
/** A link to another part of My groups, as a card. */
const LinkCard = ({ to, icon, title, text, cta, testid, textTestid }) => (
  <Link to={to} className="mcard mcard-link acc-glink" data-testid={testid}>
    <span className="mcard-ic violet" aria-hidden="true">{icon}</span>
    <span className="stack g4" style={{ flex: '1 1 200px', minWidth: 0 }}><strong className="mserif acc-glink-t">{title}</strong><span className="small muted" data-testid={textTestid}>{text}</span></span>
    <span className="btn btn-outline">{cta}</span>
  </Link>
);

const NEW = '__new__';
const consentKey = (code) => `nm7-join-consent:${code}`;
const remembered = (code) => { try { return sessionStorage.getItem(consentKey(code)) === '1'; } catch { return false; } };
const remember = (code, on) => { try { if (on) sessionStorage.setItem(consentKey(code), '1'); else sessionStorage.removeItem(consentKey(code)); } catch { /* ignore */ } };
export const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function useServer(path) {
  const [st, setSt] = useState({ loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) { setSt({ loading: false }); return undefined; }
    let off = false;
    setSt({ loading: true });
    http(path).then((data) => !off && setSt({ data }), (error) => !off && setSt({ error }));
    return () => { off = true; };
  }, [path, n]);
  return { ...st, reload: () => setN((x) => x + 1) };
}

/** Newest first, the default being the most recently updated. */
const byUpdated = (rs) => [...(rs || [])].sort((a, b) => (b.updated || 0) - (a.updated || 0));

/** The group's questions (roll number, branch …) — shared by the join page and "Edit answers". */
function FieldInputs({ defs, values, set, idPrefix = 'jf' }) {
  return defs.map((f) => (
    <div className="field" key={f.key}>
      <label className="label" htmlFor={`${idPrefix}-${f.key}`}>{f.label}{f.required ? ' *' : ''}</label>
      {f.type === 'select' ? (
        <select id={`${idPrefix}-${f.key}`} className="input" value={values[f.key] || ''} onChange={(e) => set({ ...values, [f.key]: e.target.value })}>
          <option value="">Choose…</option>
          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : <input id={`${idPrefix}-${f.key}`} className="input" value={values[f.key] || ''} maxLength={120} onChange={(e) => set({ ...values, [f.key]: e.target.value })} />}
    </div>
  ));
}

function Frame({ children }) {
  return (<><Header /><main id="main" className="container stack g20 og-join-page" style={{ maxWidth: 680, padding: '32px 16px 72px' }}>{children}</main><SiteFooter /></>);
}

/** /join/:code */
export function Join() {
  const { code: raw } = useParams();
  const code = cleanCode(raw);
  usePageMeta({ title: 'Join a group', description: 'Share your resume with your organization for printing and placement support.', noindex: true });
  const { user, ready } = useAuth();
  const info = useServer(LIVE ? `/api/public/join/${encodeURIComponent(code)}` : null);
  const customer = user?.role === 'customer';
  const resumes = useServer(LIVE && customer ? '/api/me/resumes' : null);
  const [consent, setConsent] = useState(() => remembered(code));
  const [recruit, setRecruit] = useState(() => remembered(`${code}:recruiters`)); // never ticked for them
  const [values, setValues] = useState({});
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nav = useNavigate();
  const toast = useToast();
  useEffect(() => { remember(code, consent); }, [code, consent]);
  useEffect(() => { remember(`${code}:recruiters`, recruit); }, [code, recruit]);
  const list = byUpdated(resumes.data);
  const chosen = pick || list[0]?.id || NEW;

  if (!LIVE) return <Frame><h1 className="display h2">Join a group</h1><p className="muted">Groups work on the live site (nm7.si) only.</p></Frame>;
  if (info.loading || !ready) return <Frame><div className="row g12 muted" role="status"><Spinner /> Loading…</div></Frame>;
  if (info.error) {
    return (
      <Frame>
        <div className="mcard mcard-bad og-center-card" role="alert">
          <span className="og-big-ic bad" aria-hidden="true">!</span>
          <h1 className="display" style={{ fontSize: 26 }}>{info.error.code === 'network' ? 'We can’t reach Nm7' : 'This join link doesn’t work'}</h1>
          <p>{info.error.message}</p>
          <span className="small muted">Code: <strong className="mono">{code || '—'}</strong>. Ask your organizer for the right code or link.</span>
          <Link to="/" className="btn btn-outline">Go to Nm7</Link>
        </div>
      </Frame>
    );
  }
  const j = info.data;
  const defs = j.group.customFields || [];
  const missing = defs.filter((f) => f.required && !String(values[f.key] || '').trim());
  const here = encodeURIComponent(`/join/${code}`);

  const submit = async (e) => {
    e.preventDefault();
    if (!consent) { setError('Please tick the box to agree first.'); return; }
    if (missing.length) { setError(`Please fill in: ${missing.map((f) => f.label).join(', ')}.`); return; }
    setBusy(true); setError('');
    try {
      await flush(); // unsaved builder edits first
      let resumeId = chosen;
      if (chosen === NEW) {
        resumeId = `r-${Date.now().toString(36)}`;
        await createResume({ id: resumeId, name: `${j.group.name}`.slice(0, 80), data: blankResume(), active: true });
      }
      await http('/api/me/groups/join', { method: 'POST', body: { code, consent: true, fields: values, resumeId, recruiterOptIn: !!(recruit && j.group.shareWithRecruiters) } });
      remember(code, false); remember(`${code}:recruiters`, false);
      if (chosen === NEW) {
        window.location.assign('/builder'); // a fresh load: the builder opens the new (now active) resume
      } else {
        toast(`You joined ${j.group.name}`);
        reloadMe();
        nav('/me/groups');
      }
    } catch (err) {
      setError(err.message);
      toast(err.message); // on a phone the form's last line can be below the screen
    } finally { setBusy(false); }
  };

  return (
    <Frame>
      <div className="mcard og-join-hero">
        <span className="og-join-av" aria-hidden="true">{(j.org.name || '?').trim().charAt(0).toUpperCase()}</span>
        <div className="stack g4" style={{ minWidth: 0 }}>
          <span className="mchip mchip-neutral" style={{ alignSelf: 'flex-start' }}>{j.org.typeName}{j.org.city ? ` · ${j.org.city}` : ''}</span>
          <h1 className="display h2 og-join-name">{j.org.name}</h1>
          <p className="lead og-join-group">{j.group.name}</p>
        </div>
        <span className="og-join-art" aria-hidden="true"><Still shape="college" tint="college" className="og-head-still" /></span>
      </div>
      <ol className="og-join-steps" aria-label="How joining works">
        <li><span className="og-join-n" aria-hidden="true">1</span>Agree to share</li>
        <li><span className="og-join-n" aria-hidden="true">2</span>{user ? 'Answer a few questions' : 'Sign in or sign up'}</li>
        <li><span className="og-join-n" aria-hidden="true">3</span>Pick your resume</li>
      </ol>
      <p className="og-join-intro">{j.org.name} uses Nm7 to collect and print resumes{j.group.endsOn ? ` (until ${fmtDay(Date.parse(j.group.endsOn))})` : ''}. Build or pick your resume here — it’s free — and share it with them in one step. You can leave the group any time from your dashboard.{j.group.requireApproval ? ` ${j.org.name} checks new members before their resume is shared.` : ''}</p>
      <form className="mcard og-join-form" onSubmit={submit} aria-label="Join this group">
        <label className="og-toggle-row">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{j.consentText}</span>
        </label>
        {j.group.shareWithRecruiters && (
          <label className="og-toggle-row">
            <input type="checkbox" checked={recruit} onChange={(e) => setRecruit(e.target.checked)} />
            <span>Allow {j.org.name} to share my resume with recruiters <span className="small muted">(optional — you can change this any time in My groups)</span></span>
          </label>
        )}
        {!user && (
          <div className="stack g8">
            <span className="small muted">Next: create a free account (or sign in) so your resume is saved.</span>
            <div className="row g8 og-join-auth">
              <Link className="btn btn-signal" to={consent ? `/signup?next=${here}` : '#'} onClick={(e) => { if (!consent) { e.preventDefault(); setError('Please tick the box to agree first.'); } }}>Create a free account</Link>
              <Link className="btn btn-outline" to={consent ? `/login?next=${here}` : '#'} onClick={(e) => { if (!consent) { e.preventDefault(); setError('Please tick the box to agree first.'); } }}>I have an account — sign in</Link>
            </div>
          </div>
        )}
        {user && !customer && <p className="small" role="alert">You’re signed in with a {user.role} account. Please sign in with your own (customer) account to join.</p>}
        {customer && (
          <>
            {defs.length > 0 && <div className="og-join-fields"><FieldInputs defs={defs} values={values} set={setValues} /></div>}
            <div className="field">
              <label className="label" htmlFor="jf-resume">Resume to share</label>
              {resumes.loading ? <span className="small muted"><Spinner /> Loading your resumes…</span> : (
                <select id="jf-resume" className="input" value={chosen} onChange={(e) => setPick(e.target.value)}>
                  {list.map((r) => <option key={r.id} value={r.id}>{r.name} · updated {fmtDay(r.updated)}</option>)}
                  <option value={NEW}>Start a new resume</option>
                </select>
              )}
              <span className="xs faint">You can change this later in your dashboard, under My groups.</span>
            </div>
            <button type="submit" className="btn btn-signal btn-lg og-join-submit" disabled={busy || resumes.loading}>{busy ? 'Joining…' : chosen === NEW ? 'Join and build my resume' : 'Join and share this resume'}</button>
          </>
        )}
        {error && <p className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      </form>
      <p className="xs faint og-join-safe"><IcLock size={14} /> Nm7 never asks for Aadhaar or other ID numbers. Only {j.org.name} and Nm7 see what you share.</p>
    </Frame>
  );
}

/** /me/groups */
export function MeGroups() {
  const toast = useToast();
  const nav = useNavigate();
  const groups = useServer(LIVE ? '/api/me/groups' : null);
  const resumes = useServer(LIVE ? '/api/me/resumes' : null);
  const staff = useServer(LIVE ? '/api/me/orgs' : null);
  const drives = useServer(LIVE ? '/api/me/drives' : null);
  const offers = useServer(LIVE ? '/api/me/offers' : null);
  const alumni = useServer(LIVE ? '/api/me/alumni' : null);
  const cgroups = useServer(LIVE ? '/api/me/college-groups' : null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (fn, ok) => { setBusy(true); try { await fn(); toast(ok); groups.reload(); } catch (e) { toast(e.message); } finally { setBusy(false); } };
  const list = byUpdated(resumes.data);
  return (
    <div className="stack g20">
      <MeHead title="My groups" sub="Colleges, institutes and job fairs you share your resume with." />
      <form className="mcard mcard-accent acc-join" aria-label="Join a group" onSubmit={(e) => { e.preventDefault(); if (cleanCode(code)) nav(`/join/${cleanCode(code)}`); }}>
        <span className="mcard-ic" aria-hidden="true"><IcFlag /></span>
        <div className="field" style={{ flex: '1 1 220px' }}>
          <label className="label" htmlFor="g-code">Join a group</label>
          <input id="g-code" className="input mono" placeholder="e.g. JNTUA26" value={code} maxLength={20} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-describedby="g-code-h" />
          <span id="g-code-h" className="xs faint">Your college or job fair gives you this code.</span>
        </div>
        <button type="submit" className="btn btn-signal" disabled={!cleanCode(code)}>Continue</button>
      </form>
      {LIVE && <MyInterviews />}
      {(drives.data?.length > 0 || alumni.data?.browse?.length > 0 || alumni.data?.canJoin?.length > 0 || alumni.data?.profiles?.length > 0 || cgroups.data?.length > 0 || staff.data?.length > 0) && (
        <div className="mgrid">
          {drives.data?.length > 0 && <LinkCard to="/me/drive" testid="drive-link" icon={<IcCalendar />} title="My drive day" text={`${drives.data[0].name} · ${drives.data[0].date} · ${drives.data[0].slots.length} slot${drives.data[0].slots.length === 1 ? '' : 's'}`} cta="Open" />}
          {(alumni.data?.browse?.length > 0 || alumni.data?.canJoin?.length > 0 || alumni.data?.profiles?.length > 0) && <LinkCard to="/me/alumni" testid="alumni-link" icon={<IcCap />} title="Alumni network" text={alumni.data.canJoin.length ? 'Your batch has passed out: join your college’s alumni network.' : 'Ask alumni for a referral or mentoring.'} cta="Open" />}
          {cgroups.data?.map((g) => <LinkCard key={g.id} to={`/college-group/${g.id}`} testid="cg-link" icon={<IcGlobe />} title={`You run ${g.name}`} text={`College group · ${g.campuses} campuses · numbers by campus`} cta="Open" />)}
          {staff.data?.map((o) => <LinkCard key={o.orgId} to={o.role === 'reviewer' ? `/review/${o.orgId}` : `/org/${o.orgId}`} icon={<IcBuilding />} title={`You help run ${o.orgName}`} text={staffSummary(o)} textTestid="staff-summary" cta="Open organization" />)}
        </div>
      )}
      {offers.data?.length > 0 && (
        <section className="mcard" aria-label="My offers" data-testid="my-offers">
          <header className="mcard-h"><span className="mcard-ic teal" aria-hidden="true"><IcStar /></span><span className="mcard-ht"><h2 className="mcard-title">My offers</h2><span className="mcard-sub">Recorded by your college’s placement office. Only you and your college see these.</span></span></header>
          <ul className="mlist">
            {offers.data.map((o) => <li key={o.id} className="mitem" data-testid="my-offer"><span className="mitem-main"><span className="mitem-title">{o.company}</span><span className="mitem-meta">{[o.role, o.ctcLpa != null ? `${o.ctcLpa} LPA` : null, o.typeName].filter(Boolean).join(' · ')}</span></span><Chip>{o.statusName}</Chip></li>)}
          </ul>
        </section>
      )}
      {!LIVE && <Empty shape="handshake" compact title="Groups work on the live site only." />}
      {groups.loading && <Skel cards={2} label="Loading…" />}
      {groups.error && <div className="mcard mcard-bad" role="alert">{groups.error.message}</div>}
      {groups.data?.length === 0 && <Empty shape="handshake" title="No groups yet" action={<a href="#g-code" className="btn btn-outline" onClick={(e) => { e.preventDefault(); document.getElementById('g-code')?.focus(); }}>Enter a code</a>}>You’re not in any group yet. Your college or job fair will give you a code or a QR code.</Empty>}
      {groups.data?.map((g) => {
        const ms = memberStatus(g);
        return (
          <section key={g.id} className="mcard acc-group" aria-label={g.groupName}>
            <header className="mcard-h">
              <span className="mavatar" aria-hidden="true">{(g.orgName || '?')[0]}</span>
              <span className="mcard-ht"><h2 className="mcard-title">{g.orgName}</h2><span className="mcard-sub">{g.groupName} · joined {fmtDay(g.joinedAt)} · code <span className="mono">{g.code}</span></span></span>
              <span className="mcard-actions">
                <Chip tone={chipTone(ms.tone)} testid="group-status">{ms.label}</Chip>
                {g.downloadsFree && g.approval === 'approved' && <Chip tone="ok">Free downloads</Chip>}
              </span>
            </header>
            {g.approval === 'pending' && <span className="small muted">{g.orgName} checks new members first. Keep building your resume meanwhile.</span>}
            {g.reviewStatus === 'needs_changes' && g.reviewNote && (
              <div className="acc-note acc-note-warn stack g4 small" role="note"><strong>{g.orgName} asked for changes:</strong><span style={{ whiteSpace: 'pre-wrap' }}>{g.reviewNote}</span><Link to="/builder">Open my resume</Link></div>
            )}
            {g.format && <CollegeFormat g={g} resume={list.find((r) => r.id === g.resumeId)} />}
            {g.academic && <Marks g={g} />}
            {Object.keys(g.fields || {}).length > 0 && (
              <span className="small">{(g.customFields || []).filter((f) => g.fields[f.key]).map((f) => `${f.label}: ${g.fields[f.key]}`).join(' · ')}</span>
            )}
            {g.shortlistedBy?.length > 0 && (
              <div className="mrow" data-testid="shortlisted-by">
                {g.shortlistedBy.map((c) => <span key={c} className="badge b-success">Shortlisted by {c}</span>)}
              </div>
            )}
            <div className="acc-gset">
              <div className="field">
                <label className="label" htmlFor={`g-r-${g.id}`}>Shared resume</label>
                <select id={`g-r-${g.id}`} className="input" value={g.resumeId || ''} disabled={busy || !list.length}
                  onChange={(e) => act(() => http(`/api/me/groups/${g.id}`, { method: 'PATCH', body: { resumeId: e.target.value } }), 'Shared resume changed')}>
                  {list.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  {!list.some((r) => r.id === g.resumeId) && <option value={g.resumeId || ''}>(deleted resume)</option>}
                </select>
              </div>
              <div className="stack g8">
                <label className="acc-switch small">
                  <input type="checkbox" checked={!g.remindersOptOut} disabled={busy}
                    onChange={(e) => act(() => http(`/api/me/groups/${g.id}`, { method: 'PATCH', body: { remindersOptOut: !e.target.checked } }), e.target.checked ? 'Reminders on' : 'Reminders off')} />
                  Reminder emails
                </label>
                {g.shareWithRecruiters && (
                  <label className="acc-switch small">
                    <input type="checkbox" checked={!!g.recruiterOptIn} disabled={busy}
                      onChange={(e) => act(() => http(`/api/me/groups/${g.id}`, { method: 'PATCH', body: { recruiterOptIn: e.target.checked } }), e.target.checked ? 'Recruiters can see your resume when shared' : 'Removed from recruiter links')} />
                    Allow {g.orgName} to share my resume with recruiters
                  </label>
                )}
              </div>
            </div>
            <div className="acc-gfoot">
              <button type="button" className="btn btn-outline acc-danger-btn" disabled={busy}
                onClick={() => { if (window.confirm(`Leave ${g.groupName}? ${g.orgName} will no longer see your resume.`)) act(() => http(`/api/me/groups/${g.id}/leave`, { method: 'POST', body: {} }), 'You left the group'); }}>Leave group</button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** "Your college uses an official placement format": the shared resume shown in it (layout only — nothing in the
 * resume changes) and a checklist of the college's rules it doesn't meet yet. */
function CollegeFormat({ g, resume }) {
  const [pages, setPages] = useState(null);
  const data = resume?.data;
  const roll = (g.customFields || []).find((f) => /roll|reg|enrol/i.test(`${f.key} ${f.label}`));
  const brand = brandFor(g.format, roll ? g.fields?.[roll.key] : '');
  const items = checklist(data, g.format, pages);
  const todo = items.filter((i) => !i.ok);
  return (
    <div className="well stack g12" data-testid="college-format">
      <strong className="small">Your college uses an official placement format</strong>
      <span className="xs muted">{g.orgName} prints and shares your resume in its own format: same content, their layout and header. Your own resume and downloads don’t change.</span>
      {items.length > 0 && (
        <ul className="stack g4" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="College rules" data-testid="format-checklist">
          {items.map((i) => <li key={i.key} className="row g8 small" style={{ alignItems: 'baseline' }}><span aria-hidden="true" style={{ color: i.ok ? 'var(--success)' : 'var(--warning)' }}>{i.ok ? <IcCheck size={14} /> : <IcAlert size={14} />}</span><span>{i.text}</span><span className="sr-only">{i.ok ? 'done' : 'to fix'}</span></li>)}
        </ul>
      )}
      {todo.length > 0 && <Link to="/builder" className="small">Fix these in my resume</Link>}
      {data && (
        <div style={{ maxWidth: 420, width: '100%' }} aria-label="Your resume in the college format">
          <ErrorBoundary title="This resume couldn’t be shown." text="Something in it couldn’t be drawn. Try again, or ask the student to open and save it once."><ResumePreview data={data} design={brandDesign(g.format, data)} brand={brand} onPages={setPages} decorative /></ErrorBoundary>
        </div>
      )}
    </div>
  );
}
