// The coordinator portal (Nm7 for Organizations, Phase 2): /org, /org/:orgId (groups), …/resumes, …/groups/:groupId
// (dashboard), …/activity. Plus the invite link (/org/invite/:token) and the reminder opt-out link (/groups/stop).
// Coordinators sign in with their own Nm7 account; the admin console is never shown here. Everything they can see
// is scoped by the server to their organization (and groups) — these screens only arrange it.
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import Header from '../../components/Header';
import { Spinner, useToast } from '../../components/ui';
import { LIVE, useAuth } from '../../lib/auth';
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
import { planBanners } from '../../lib/orgBilling';

const ROLE = { owner: 'Owner', coordinator: 'Coordinator', viewer: 'Viewer (view and print)', admin: 'Nm7 admin' };

function Frame({ children, wide }) {
  return (<><Header variant="me" /><main id="main" className={`${wide ? 'container-wide' : 'container'} stack g20`} style={{ padding: '24px 16px 72px', maxWidth: wide ? undefined : 720 }}>{children}</main></>);
}

/** /org: the organization(s) this account helps run. */
export function OrgHome() {
  usePageMeta({ title: 'My organization', description: 'Run your organization’s resume drive on Nm7.', noindex: true });
  const st = useApi(LIVE ? '/api/me/orgs' : null);
  if (!LIVE) return <Frame><h1 className="display h2">My organization</h1><p className="muted">The organization portal works on the live site only.</p></Frame>;
  return (
    <Frame>
      <Loading st={st}>{(orgs) => (orgs.length === 1 ? <Navigate to={`/org/${orgs[0].orgId}`} replace /> : (
        <>
          <h1 className="display h2">My organization</h1>
          {orgs.length === 0
            ? <div className="card stack g8"><strong>You don’t run an organization on Nm7 yet.</strong><span className="small muted">Start one for free (you become its Owner), or ask your organization’s Owner for an invite — it comes by email with a one-time link.</span><Link to="/for-orgs?start=1#start" className="btn btn-ink" style={{ alignSelf: 'flex-start' }}>Start an organization</Link></div>
            : orgs.map((o) => <Link key={o.orgId} to={`/org/${o.orgId}`} className="card row between g8" style={{ textDecoration: 'none', color: 'inherit' }}><strong>{o.orgName}</strong><span className="small muted">{ROLE[o.role]}</span></Link>)}
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
  const tabs = [['', 'My groups'], ['/dashboard', 'Dashboard'], ['/resumes', 'Shared resumes'], ...(st.data?.features?.kiosk ? [['/kiosks', 'Kiosks']] : []), ...(st.data?.features?.branding ? [['/branding', 'Branding']] : []), ...(st.data?.features?.recruiterLinks ? [['/recruiters', 'Recruiter links']] : []), ...(owner ? [['/team', 'Team'], ['/billing', 'Billing']] : []), ['/activity', 'Activity']];
  return (
    <Frame wide>
      {st.error ? (
        <div className="card stack g8" role="alert"><strong>{st.error.status === 404 ? 'You don’t have access to this organization' : 'Couldn’t load this'}</strong><span className="small muted">{st.error.status === 404 ? 'Your access may have been removed. Ask Nm7 if this is a mistake.' : st.error.message}</span><Link to="/org">My organizations</Link></div>
      ) : !st.data ? <div className="row g12 muted" role="status"><Spinner /> Loading…</div> : (
        <>
          <div className="stack g4">
            <span className="xs muted">{st.data.typeName}{st.data.city ? ` · ${st.data.city}` : ''} · {ROLE[st.data.role]}{st.data.allGroups ? '' : ' · some groups'} · {st.data.billing?.planName || 'Free'} plan</span>
            <h1 className="display" style={{ fontSize: 28 }}>{st.data.name}</h1>
          </div>
          <PlanBanners home={st.data} orgId={orgId} />
          <nav aria-label="Organization" className="row g8" style={{ flexWrap: 'wrap' }}>
            {tabs.map(([to, l]) => <NavLink key={l} to={`/org/${orgId}${to}`} end={to === ''} className={({ isActive }) => `btn ${isActive || (to === '' && pathname.includes('/groups/')) ? 'btn-ink' : 'btn-outline'}`} style={{ minHeight: 36 }}>{l}</NavLink>)}
          </nav>
          <Outlet context={{ ctx, home: st.data, reload: st.reload }} />
        </>
      )}
    </Frame>
  );
}

/** Plan banners (80% of a limit used, plan ending within 7 days, grace, back on Free). Everyone sees them; the
 * Owner gets a link to Billing, the others are told to ask the Owner. */
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
      {home.groupList.length === 0 && <div className="well small muted" style={{ textAlign: 'center', padding: 24 }}>No groups yet.{home.canCreateGroups ? ' A group is one batch, event or drive with its own join code.' : ''}</div>}
      {home.groupList.map((g) => <GroupCard key={g.id} g={g} ctx={ctx} busy={busy} run={run} reload={reload} toast={toast} />)}
      {home.canCreateGroups && <NewGroup ctx={ctx} url={`${ctx.base}/groups`} busy={busy} run={run} reload={reload} />}
    </>
  );
}

/** /org/:orgId/dashboard — the placement dashboard (whole organization or one group) */
export function PortalPlacement() {
  const { ctx, home } = useOutletContext();
  usePageMeta(portalMeta(`Dashboard · ${home.name}`));
  return <Placement base={ctx.base} role={ctx.role} canManage={home.canManage} billingUrl={home.isOwner ? `/org/${ctx.orgId}/billing` : null} />;
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
  return <GroupDashboard ctx={ctx} groupId={groupId} onBack={<Link className="btn btn-outline" to={`/org/${ctx.orgId}`}>All groups</Link>} />;
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
        <div className="card stack g8" role="alert"><h1 className="display" style={{ fontSize: 26 }}>This invite doesn’t work</h1><p>{info.error.message}</p></div>
      ) : !info.data || !ready ? <div className="row g12 muted" role="status"><Spinner /> Loading…</div> : (
        <div className="card stack g16">
          <h1 className="display" style={{ fontSize: 26 }}>Join {info.data.orgName} on Nm7</h1>
          <p>You’re invited as a <strong>{info.data.role === 'viewer' ? 'viewer (view and print)' : 'coordinator'}</strong> for <strong>{info.data.orgName}</strong>. You’ll see your organization’s shared resumes, and nothing else.</p>
          <p className="small muted">The invite is for <strong>{info.data.email}</strong>. Use your own Nm7 account with that email address.</p>
          {!user && (
            <div className="row g8">
              <Link className="btn btn-ink" to={`/signup?next=${here}`}>Create a free account</Link>
              <Link className="btn btn-outline" to={`/login?next=${here}`}>Sign in</Link>
            </div>
          )}
          {user && user.role !== 'customer' && <p className="small" role="alert">You’re signed in with a {user.role} account. Sign out and sign in with {info.data.email}.</p>}
          {user?.role === 'customer' && <button type="button" className="btn btn-ink btn-lg" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={accept}>{busy ? 'Accepting…' : 'Accept the invite'}</button>}
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
        : st.error ? <div className="card stack g8" role="alert"><strong>This link doesn’t work</strong><span className="small muted">{st.error.message}</span><Link to="/me/groups">My groups</Link></div>
          : (
            <div className="card stack g8" role="status">
              <h1 className="display" style={{ fontSize: 26 }}>Reminders stopped</h1>
              <p>You won’t get reminder emails from {st.data?.orgName ? `${st.data.orgName} (${st.data.groupName})` : 'this group'} any more. Your resume is still shared with them.</p>
              <span className="small muted">You can switch reminders back on, or leave the group, in your dashboard.</span>
              <Link to="/me/groups" className="btn btn-outline" style={{ alignSelf: 'flex-start' }}>My groups</Link>
            </div>
          )}
    </Frame>
  );
}
