// The coordinator portal (Nm7 for Organizations, Phase 2): /org, /org/:orgId (groups), …/resumes, …/groups/:groupId
// (dashboard), …/activity. Plus the invite link (/org/invite/:token) and the reminder opt-out link (/groups/stop).
// Coordinators sign in with their own Nm7 account; the admin console is never shown here. Everything they can see
// is scoped by the server to their organization (and groups) — these screens only arrange it.
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import Header from '../../components/Header';
import { Spinner, useToast } from '../../components/ui';
import { LIVE, signOut, useAuth } from '../../lib/auth';
import { apiBase } from '../../lib/orgDashboard';
import { usePageMeta } from '../../lib/meta';
import { http } from '../../services/http';
import { Loading, useAction, useApi } from '../admin/live/common';
import { AuditList, GroupCard, GroupDashboard, NewGroup, SharedResumes } from '../admin/live/OrgPages';
import Kiosks from './Kiosks';
import Branding from './Branding';
import RecruiterLinks from './RecruiterLinks';
import RecruiterInvites from './RecruiterInvites';
import Billing from './Billing';
import Team from './Team';
import Placement from './Placement';
import Drives from './Drives';
import Offers from './Offers';
import Alumni from './Alumni';
import Reviewers from './Reviewers';
import { planBanners } from '../../lib/orgBilling';
import RecruiterFeedback from './RecruiterFeedback';
// Profile setup P3: the college's setup checklist on My groups and Dashboard (its own small chunk)
const TeamChecklist = lazy(() => import('../me/TeamChecklist'));

import { Still } from '../newhome/ParticleStage';
import { TINTS, SHAPE_COLORS } from '../newhome/shapes';
import '../../styles/me-kit.css';
import '../../styles/org.css';
import '../../styles/org-groups.css';
import { Empty } from '../me/kit';
import { IcArrowLeft, IcArrowRight, IcCalendar, IcCap, IcCheck, IcClock, IcEdit, IcFile, IcGlobe, IcGrid, IcLink, IcMail, IcPhone, IcSwap, IcUser, IcUsers, IcWallet } from '../../components/icons';

TINTS.college = SHAPE_COLORS.college; // colleges: teal (round P, Phase 4)

const ROLE = { owner: 'Owner', coordinator: 'Coordinator', viewer: 'Viewer (view and print)', reviewer: 'Reviewer', admin: 'Nm7 admin' };

/** wide: the portal with its side menu fills the screen (round W: 24 px sides, 16 px on a phone). */
function Frame({ children, wide }) {
  return (<><Header variant="me" /><main id="main" className={`${wide ? 'app-wide og-wide' : 'container'} stack g20`} style={wide ? { paddingBlock: '20px 72px' } : { padding: '24px 16px 72px', maxWidth: 720 }}>{children}</main></>);
}

/** /org: the organization(s) this account helps run. */
export function OrgHome() {
  usePageMeta({ title: 'My organization', description: 'Run your organization’s resume drive on Nm7.', noindex: true });
  const st = useApi(LIVE ? '/api/me/orgs' : null);
  const tr = useApi(LIVE ? '/api/me/org-transfers' : null);
  const asked = tr.data || [];
  if (!LIVE) return <Frame><h1 className="display h2">My organization</h1><p className="muted">The organization portal works on the live site only.</p></Frame>;
  return (
    <Frame>
      {asked.length > 0 && <Link to="/org/transfer" className="mcard mcard-accent mcard-link og-transfer" data-testid="transfer-waiting"><span className="mcard-ic" aria-hidden="true"><IcSwap /></span><span className="stack g4"><strong>You’ve been asked to become the Owner of {asked.map((t) => t.orgName).join(', ')}</strong><span className="small muted">Enter the code from the email</span></span></Link>}
      <Loading st={st}>{(orgs) => (orgs.length === 1 && !asked.length && (tr.data !== null || tr.error) ? <Navigate to={orgs[0].role === 'reviewer' ? `/review/${orgs[0].orgId}` : `/org/${orgs[0].orgId}`} replace /> : (
        <>
          <div className="og-home-head">
            <h1 className="display h2">My organization</h1>
            <span className="og-home-art" aria-hidden="true"><Still shape="college" tint="college" className="og-head-still" /></span>
          </div>
          {orgs.length === 0
            ? <Empty shape="college" tint="college" title="You don’t run an organization on Nm7 yet." action={<Link to="/for-orgs?start=1#start" className="btn btn-signal">Start an organization</Link>}>Start one for free (you become its Owner), or ask your organization’s Owner for an invite — it comes by email with a one-time link.</Empty>
            : <div className="og-org-list">{orgs.map((o) => <Link key={o.orgId} to={o.role === 'reviewer' ? `/review/${o.orgId}` : `/org/${o.orgId}`} className="mcard mcard-link og-org-card"><span className="og-avatar" aria-hidden="true">{(o.orgName || '?').trim().charAt(0).toUpperCase()}</span><strong className="og-org-name">{o.orgName}</strong><span className="mchip mchip-neutral">{ROLE[o.role]}</span><span className="og-org-go" aria-hidden="true"><IcArrowRight /></span></Link>)}</div>}
        </>
      ))}</Loading>
    </Frame>
  );
}

/** /org/:orgId/* — the frame: organization name, role and tabs (works on phones: tabs wrap). */
export function PortalLayout() {
  const { orgId } = useParams();
  const st = useApi(`/api/org/${encodeURIComponent(orgId)}`);
  const { pathname } = useLocation();
  const ctx = useMemo(() => (st.data ? {
    base: apiBase(orgId),
    orgId,
    orgName: st.data.name || '',
    role: st.data.role,
    canManage: st.data.canManage,
    features: st.data.features || {},
    sharedUrl: (params = {}) => `/org/${orgId}/resumes?${new URLSearchParams(params)}`,
    dashboardUrl: (g) => `/org/${orgId}/groups/${g.id}`,
    groupPatchUrl: (g) => `${apiBase(orgId)}/groups/${g.id}`,
  } : null), [st.data, orgId]);
  const owner = !!st.data?.isOwner;
  const f = st.data?.features || {};
  // round P, Phase 4: the side menu in groups (students, drives, reaching out, running the college); the same links
  // and conditions as before, each with a symbol; the section title shows a small teal dotted shape on a desktop
  const groups = [
    [['', 'My groups', <IcUsers key="i" />], ['/dashboard', 'Dashboard', <IcGrid key="i" />], ['/resumes', 'Shared resumes', <IcFile key="i" />]],
    [...(f.drives ? [['/drives', 'Drives', <IcCalendar key="i" />]] : []), ...(f.offers ? [['/offers', 'Offers', <IcMail key="i" />]] : []), ...(f.kiosk ? [['/kiosks', 'Kiosks', <IcPhone key="i" />]] : [])],
    [...(f.recruiterLinks ? [['/recruiters', 'Recruiter links', <IcLink key="i" />]] : []), ...(f.alumni ? [['/alumni', 'Alumni', <IcCap key="i" />]] : []), ...(f.facultyReview ? [['/reviewers', 'Reviewers', <IcEdit key="i" />]] : []), ...(f.branding ? [['/branding', 'Branding', <IcGlobe key="i" />]] : [])],
    [...(owner ? [['/team', 'Team', <IcUser key="i" />], ['/billing', 'Billing', <IcWallet key="i" />]] : []), ['/activity', 'Activity', <IcClock key="i" />]],
  ].filter((g) => g.length);
  const all = groups.flat();
  const sub = pathname.replace(`/org/${orgId}`, '').replace(/\/$/, '');
  const current = all.find(([to]) => to && sub.startsWith(to)) || all[0];
  const SHAPE = { '': 'college', '/dashboard': 'college', '/resumes': 'resume', '/drives': 'handshake', '/offers': 'badge', '/kiosks': 'magnifier', '/recruiters': 'handshake', '/alumni': 'cap', '/reviewers': 'resume', '/branding': 'badge', '/team': 'handshake', '/billing': 'sphere', '/activity': 'resume' };
  return (
    <Frame wide>
      {st.error ? (
        <div className="card stack g8" role="alert"><strong>{st.error.status === 404 ? 'You don’t have access to this organization' : 'Couldn’t load this'}</strong><span className="small muted">{st.error.status === 404 ? 'Your access may have been removed. Ask Nm7 if this is a mistake.' : st.error.message}</span><Link to="/org">My organizations</Link></div>
      ) : !st.data ? <div className="row g12 muted" role="status"><Spinner /> Loading…</div> : (
        <div className="og-shell">
          <aside className="og-side">
            <div className="og-side-head">
              <span className="og-avatar" aria-hidden="true">{(st.data.name || '?').trim().charAt(0).toUpperCase()}</span>
              <span className="stack g4" style={{ minWidth: 0 }}>
                <span className="xs muted">{st.data.typeName}{st.data.city ? ` · ${st.data.city}` : ''} · {ROLE[st.data.role]}{st.data.allGroups ? '' : ' · some groups'} · {st.data.billing?.planName || 'Free'} plan</span>
                <h1 className="og-name">{st.data.name}</h1>
              </span>
            </div>
            <nav aria-label="Organization" className="og-nav">
              {groups.map((g, gi) => (
                <div key={gi} className="og-nav-group">
                  {g.map(([to, l, ic]) => <NavLink key={l} to={`/org/${orgId}${to}`} end={to === ''} className={({ isActive }) => `og-link ${isActive || (to === '' && pathname.includes('/groups/')) ? 'on' : ''}`}><span className="og-link-ic" aria-hidden="true">{ic}</span>{l}</NavLink>)}
                </div>
              ))}
            </nav>
          </aside>
          <div className="og-main stack g16">
            <div className="og-head" aria-hidden="true">
              <span className="og-head-ic">{current[2]}</span>
              <span className="og-head-title">{pathname.includes('/groups/') ? 'My groups' : current[1]}</span>
              <span className="og-head-art"><Still shape={SHAPE[current[0]] || 'college'} tint="college" className="og-head-still" /></span>
            </div>
            {st.data.demo && <DemoBanner />}
            <PlanBanners home={st.data} orgId={orgId} />
            {LIVE && st.data.type === 'college' && (sub === '' || sub === '/dashboard') && <Suspense fallback={null}><TeamChecklist kind="college" id={orgId} /></Suspense>}
            <Outlet context={{ ctx, home: st.data, reload: st.reload }} />
          </div>
        </div>
      )}
    </Frame>
  );
}

/** Plan banners (80% of a limit used, plan ending within 7 days, grace, back on Free). Everyone sees them; the
 * Owner gets a link to Billing, the others are told to ask the Owner. */
/** The demo college: made-up data, and (for the demo coordinator) a session that can open nothing else. */
function DemoBanner() {
  const nav = useNavigate();
  const { user } = useAuth();
  return (
    <div className="well small row between g8" role="note" data-testid="demo-banner" style={{ flexWrap: 'wrap', borderLeft: '4px solid var(--warning)' }}>
      <span><span className="badge b-warning">Demo</span> Made-up college and students, for demos and testing. Nothing here is real, and nobody is emailed. A demo coordinator can open only this college.</span>
      {/* an admin's college view: Back to Admin is on the banner at the top instead */}
      {!user?.view && <button type="button" className="btn btn-outline" style={{ minHeight: 32 }} onClick={async () => { await signOut(); nav('/login'); }} data-testid="demo-signout">Sign out of the demo</button>}
    </div>
  );
}

function PlanBanners({ home, orgId }) {
  const items = planBanners(home.billing, home.isOwner);
  if (!items.length) return null;
  return (
    <div className="stack g8" role="status">
      {items.map((b) => (
        <div key={b.text} className="well small row between g8" style={{ flexWrap: 'wrap', borderLeft: `4px solid var(--${b.tone === 'danger' ? 'danger' : 'warning'})` }}>
          <span>{b.text}</span>
          {home.isOwner && home.role !== 'admin' && <Link to={`/org/${orgId}/billing`} className="btn btn-outline" style={{ minHeight: 32 }}>Billing</Link>}
        </div>
      ))}
    </div>
  );
}

/** /org/:orgId/billing — the Owner's plan, payments and billing details */
export function PortalBilling() {
  const { ctx, home } = useOutletContext();
  usePageMeta(portalMeta(`Billing · ${home.name}`));
  if (!home.isOwner) return <Navigate to={`/org/${ctx.orgId}`} replace />;
  return <Billing orgId={ctx.orgId} />;
}

/** /org/:orgId/team — the Owner invites coordinators and viewers */
export function PortalTeam() {
  const { ctx, home } = useOutletContext();
  usePageMeta(portalMeta(`Team · ${home.name}`));
  if (!home.isOwner) return <Navigate to={`/org/${ctx.orgId}`} replace />;
  return <Team orgId={ctx.orgId} groups={home.groupList} />;
}

/** /org/:orgId — groups: join link, Copy, QR PNG, open / close joining, dashboard; coordinators add and edit. */
const portalMeta = (title) => ({ title, description: 'Run your organization’s resume drive on Nm7.', noindex: true });

export function PortalGroups() {
  const { ctx, home, reload } = useOutletContext();
  usePageMeta(portalMeta(`My groups · ${home.name}`));
  const toast = useToast();
  const [busy, run] = useAction(toast);
  return (
    <>
      {home.groupList.length > 0 && (
        <div className="og-summary">
          <div className="og-tile"><span className="og-tile-l">Groups</span><strong className="og-tile-v">{home.groupList.length}</strong></div>
          <div className="og-tile"><span className="og-tile-l">Students joined</span><strong className="og-tile-v">{home.groupList.reduce((n, g) => n + (g.members || 0), 0)}</strong></div>
          <div className="og-tile"><span className="og-tile-l">Open for joining</span><strong className="og-tile-v">{home.groupList.filter((g) => g.settings?.active).length}</strong></div>
        </div>
      )}
      {home.groupList.length === 0 && <Empty shape="college" tint="college" title="No groups yet.">{home.canCreateGroups ? 'A group is one batch, event or drive with its own join code.' : 'Your organization hasn’t made a group yet.'}</Empty>}
      <div className="og-group-list" id="og-groups">
        {home.groupList.map((g) => <GroupCard key={g.id} g={g} ctx={ctx} busy={busy} run={run} reload={reload} toast={toast} />)}
      </div>
      {home.canCreateGroups && <div id="og-new"><NewGroup ctx={ctx} url={`${ctx.base}/groups`} busy={busy} run={run} reload={reload} /></div>}
      <SimpleDefault orgId={ctx.orgId} canManage={home.canManage} toast={toast} />
    </>
  );
}

/** The college's "Simple by default": its students start on the Easy dashboard (they can still switch). */
function SimpleDefault({ orgId, canManage, toast }) {
  const st = useApi(`/api/org/${orgId}/simple`);
  const [busy, run] = useAction(toast);
  if (!st.data) return null;
  const set = (on) => run(async () => { await http(`/api/org/${orgId}/simple`, { method: 'PUT', body: { simpleDefault: on } }); st.reload(); }, on ? 'Students start on the simple dashboard' : 'Students start on the full dashboard');
  return (
    <section className="mcard og-simple" aria-label="Students’ dashboard" data-testid="org-simple">
      <header className="mcard-h"><span className="mcard-ic" aria-hidden="true"><IcUser /></span><span className="mcard-ht"><strong className="mcard-title">Students’ dashboard</strong><span className="mcard-sub">What your students see first when they sign in.</span></span></header>
      <label className="og-toggle-row small"><input type="checkbox" checked={st.data.simpleDefault} disabled={busy || !canManage} onChange={(e) => set(e.target.checked)} data-testid="org-simple-on" /><span>Simple by default: big buttons, voice, English / Telugu / Hindi. Students can still switch to the full dashboard.</span></label>
    </section>
  );
}

/** /org/:orgId/dashboard — the placement dashboard (whole organization or one group) */
export function PortalPlacement() {
  const { ctx, home } = useOutletContext();
  usePageMeta(portalMeta(`Dashboard · ${home.name}`));
  return (
    <>
      <Placement base={ctx.base} role={ctx.role} canManage={home.canManage} billingUrl={home.isOwner ? `/org/${ctx.orgId}/billing` : null} wa={!!home.features?.waReminders} />
      {home.features?.recruiterFeedback && <RecruiterFeedback base={ctx.base} />}
    </>
  );
}

/** /org/:orgId/resumes */
export function PortalResumes() {
  const { ctx, home } = useOutletContext();
  usePageMeta(portalMeta(`Shared resumes · ${home.name}`));
  return <SharedResumes ctx={ctx} groups={home.groupList} title="Shared resumes" sub={ctx.role === 'viewer' ? 'You can view and print. Prints are logged.' : 'Approve members, ask for changes, remind and print. Everything here is logged.'} />;
}

/** /org/:orgId/groups/:groupId */
export function PortalDashboard() {
  const { ctx, home } = useOutletContext();
  const { groupId } = useParams();
  const group = home.groupList.find((g) => g.id === groupId);
  usePageMeta(portalMeta(group ? `${group.name} dashboard` : `Group dashboard · ${home.name}`));
  return <GroupDashboard ctx={ctx} groupId={groupId} onBack={<Link className="btn btn-outline og-btn-sm" to={`/org/${ctx.orgId}`}><IcArrowLeft size={16} /> All groups</Link>} />;
}

/** /org/:orgId/kiosks — only when Nm7 switched kiosks on for the organization */
export function PortalKiosks() {
  const { ctx, home } = useOutletContext();
  usePageMeta(portalMeta(`Kiosks · ${home.name}`));
  if (!home.features?.kiosk) return <Navigate to={`/org/${ctx.orgId}`} replace />;
  return <Kiosks orgId={ctx.orgId} groups={home.groupList} canManage={home.canManage} />;
}

/** /org/:orgId/branding — only when Nm7 switched branding on for the organization */
export function PortalBranding() {
  const { ctx, home } = useOutletContext();
  usePageMeta(portalMeta(`Branding · ${home.name}`));
  if (!home.features?.branding) return <Navigate to={`/org/${ctx.orgId}`} replace />;
  return <Branding orgId={ctx.orgId} canManage={home.canManage} />;
}

/** /org/:orgId/recruiters — only when Nm7 switched recruiter links on for the organization */
export function PortalRecruiters() {
  const { ctx, home } = useOutletContext();
  usePageMeta(portalMeta(`Recruiter links · ${home.name}`));
  if (!home.features?.recruiterLinks) return <Navigate to={`/org/${ctx.orgId}`} replace />;
  return <><RecruiterInvites orgId={ctx.orgId} groups={home.groupList} canManage={home.canManage} /><RecruiterLinks orgId={ctx.orgId} canManage={home.canManage} sharedUrl={ctx.sharedUrl} /></>;
}

/** /org/:orgId/activity */
export function PortalActivity() {
  const { ctx, home } = useOutletContext();
  usePageMeta(portalMeta(`Activity · ${home.name}`));
  return <AuditList url={`${ctx.base}/audit?limit=100`} sub="Everything done with your organization’s shared resumes, by your team and by Nm7." />;
}

/** /org/invite/:token — accept an invite with the invited (verified) email address. */
export function OrgInvite() {
  usePageMeta({ title: 'Organization invite', description: 'Accept your invite to run resume drives on Nm7.', noindex: true });
  const { token } = useParams();
  const { user, ready } = useAuth();
  const info = useApi(LIVE ? `/api/org-invites/${encodeURIComponent(token)}` : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nav = useNavigate();
  const here = encodeURIComponent(`/org/invite/${token}`);
  const accept = async () => {
    setBusy(true); setError('');
    try { const r = await http(`/api/org-invites/${encodeURIComponent(token)}/accept`, { method: 'POST', body: {} }); nav(`/org/${r.orgId}`, { replace: true }); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  if (!LIVE) return <Frame><p className="muted">Invites work on the live site only.</p></Frame>;
  return (
    <Frame>
      {info.error ? (
        <div className="mcard mcard-bad og-center-card" role="alert"><span className="og-big-ic bad" aria-hidden="true">!</span><h1 className="display" style={{ fontSize: 26 }}>This invite doesn’t work</h1><p>{info.error.message}</p></div>
      ) : !info.data || !ready ? <div className="row g12 muted" role="status"><Spinner /> Loading…</div> : (
        <div className="mcard og-center-card og-invite">
          <span className="og-invite-art" aria-hidden="true"><Still shape="college" tint="college" className="og-head-still" /></span>
          <span className="mchip mchip-accent">{info.data.role === 'viewer' ? 'Viewer' : 'Coordinator'} invite</span>
          <h1 className="display" style={{ fontSize: 28 }}>Join {info.data.orgName} on Nm7</h1>
          <p>You’re invited as a <strong>{info.data.role === 'viewer' ? 'viewer (view and print)' : 'coordinator'}</strong> for <strong>{info.data.orgName}</strong>. You’ll see your organization’s shared resumes, and nothing else.</p>
          <p className="small muted">The invite is for <strong>{info.data.email}</strong>. Use your own Nm7 account with that email address.</p>
          {!user && (
            <div className="row g8 og-center-actions">
              <Link className="btn btn-signal" to={`/signup?next=${here}`}>Create a free account</Link>
              <Link className="btn btn-outline" to={`/login?next=${here}`}>Sign in</Link>
            </div>
          )}
          {user && user.role !== 'customer' && <p className="small" role="alert">You’re signed in with a {user.role} account. Sign out and sign in with {info.data.email}.</p>}
          {user?.role === 'customer' && <button type="button" className="btn btn-signal btn-lg" disabled={busy} onClick={accept}>{busy ? 'Accepting…' : 'Accept the invite'}</button>}
          {error && <p className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
        </div>
      )}
    </Frame>
  );
}

/** /groups/stop?t=… — the one-click "Stop reminders from this group" link in reminder emails. */
export function StopReminders() {
  usePageMeta({ title: 'Reminders stopped', description: 'Stop reminder emails from a group.', noindex: true });
  const [params] = useSearchParams();
  const [st, setSt] = useState({ loading: true });
  useEffect(() => {
    if (!LIVE) { setSt({}); return; }
    http('/api/public/reminders/stop', { method: 'POST', body: { token: params.get('t') || '' } }).then((data) => setSt({ data }), (error) => setSt({ error }));
  }, [params]);
  return (
    <Frame>
      {st.loading ? <div className="row g12 muted" role="status"><Spinner /> One moment…</div>
        : st.error ? <div className="mcard mcard-bad og-center-card" role="alert"><span className="og-big-ic bad" aria-hidden="true">!</span><strong>This link doesn’t work</strong><span className="small muted">{st.error.message}</span><Link to="/me/groups" className="btn btn-outline">My groups</Link></div>
          : (
            <div className="mcard mcard-ok og-center-card" role="status">
              <span className="og-big-ic ok" aria-hidden="true"><IcCheck size={28} /></span>
              <h1 className="display" style={{ fontSize: 26 }}>Reminders stopped</h1>
              <p>You won’t get reminder emails from {st.data?.orgName ? `${st.data.orgName} (${st.data.groupName})` : 'this group'} any more. Your resume is still shared with them.</p>
              <span className="small muted">You can switch reminders back on, or leave the group, in your dashboard.</span>
              <Link to="/me/groups" className="btn btn-outline">My groups</Link>
            </div>
          )}
    </Frame>
  );
}

/** /org/:orgId/drives — drive days and check-in (Drive and Campus plans) */
export function PortalDrives() {
  const { ctx, home } = useOutletContext();
  usePageMeta(portalMeta(`Drives · ${home.name}`));
  if (!home.features?.drives) return <Navigate to={`/org/${ctx.orgId}`} replace />;
  return <Drives orgId={ctx.orgId} groups={home.groupList} canManage={home.canManage} features={home.features} />;
}

/** /org/:orgId/offers — offers and the placement report (Drive and Campus plans) */
export function PortalOffers() {
  const { ctx, home } = useOutletContext();
  usePageMeta(portalMeta(`Offers · ${home.name}`));
  if (!home.features?.offers) return <Navigate to={`/org/${ctx.orgId}`} replace />;
  return <Offers orgId={ctx.orgId} groups={home.groupList} canManage={home.canManage} />;
}

/** /org/:orgId/alumni — alumni invites and counts (Campus plan) */
export function PortalAlumni() {
  const { ctx, home } = useOutletContext();
  usePageMeta(portalMeta(`Alumni · ${home.name}`));
  if (!home.features?.alumni) return <Navigate to={`/org/${ctx.orgId}`} replace />;
  return <Alumni orgId={ctx.orgId} canManage={home.canManage} />;
}

/** /org/:orgId/reviewers — faculty reviewers and their students (Drive and Campus plans) */
export function PortalReviewers() {
  const { ctx, home } = useOutletContext();
  usePageMeta(portalMeta(`Reviewers · ${home.name}`));
  if (!home.features?.facultyReview) return <Navigate to={`/org/${ctx.orgId}`} replace />;
  return <Reviewers orgId={ctx.orgId} canManage={home.canManage} />;
}
