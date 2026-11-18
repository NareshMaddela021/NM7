// Admin → Daily report: the whole business on one page, updated every day. Five plain lines and a "Needs attention"
// list at the top, then the job collector, site health, users and business, the vetting engine and Auto Apply (A7). Each number has
// its change vs yesterday and a tiny 30-day sparkline. ONE request loads it all (GET /api/admin/daily-report);
// "Refresh now" recomputes today on the server and answers with the same report. Numbers: docs/admin/daily-report.md.
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner, useToast } from '../../../components/ui';
import { http, when } from './common';
import { bandWord, change, inr, msText, num, pct, reasonList, shortCommit, sparkPoints, trendWords } from './dailyReportText';
import '../../../styles/me-kit.css';
import '../../../styles/admin-daily.css';

// loaded with the report's own chunk's import map (not the main bundle's): shared with Admin → Auto Apply
const AutoApplyNumbers = lazy(() => import('./AutoApplyNumbers'));

function Sparkline({ series, fmt = num, label }) {
  const runs = sparkPoints(series, 120, 32);
  return (
    <svg className="dr-spark" viewBox="0 0 120 32" preserveAspectRatio="none" role="img" aria-label={`${label}. ${trendWords(series, fmt)}`}>
      <line x1="0" y1="31" x2="120" y2="31" className="dr-spark-base" />
      {runs.map((p) => (p.includes(' ') ? <polyline key={p} points={p} className="dr-spark-line" /> : <circle key={p} cx={p.split(',')[0]} cy={p.split(',')[1]} r="1.8" className="dr-spark-dot" />))}
    </svg>
  );
}

/** One number: today, ▲/▼ vs yesterday, a 30-day sparkline. `state` numbers have no history on backfilled days. */
function Tile({ m, k, label, fmt = num, lower = false, note, to, empty = 'No data yet' }) {
  const x = m[k] || { value: null, prev: null, series: [] };
  const c = change(x.value, x.prev, { lowerIsBetter: lower, fmt });
  return (
    <div className="dr-tile" data-testid={`dr-tile-${k}`}>
      <span className="dr-tile-l">{label}</span>
      <span className="dr-tile-v">{x.value == null ? <span className="dr-tile-none">{empty}</span> : fmt(x.value)}</span>
      <span className={`dr-delta dr-delta-${c.tone}`} data-dir={c.dir}>{c.text}</span>
      <Sparkline series={x.series} fmt={fmt} label={label} />
      {note && <span className="xs muted">{note}</span>}
      {to && <Link to={to} className="dr-tile-link small">Open</Link>}
    </div>
  );
}

function Bars({ title, rows, empty }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="dr-bars stack g6">
      <h3 className="dr-h3">{title}</h3>
      {rows.length === 0 ? <span className="small muted">{empty}</span> : (
        <ul className="dr-bar-list">
          {rows.map(([name, n]) => (
            <li key={name} className="dr-bar-row">
              <span className="dr-bar-name">{name}</span>
              <span className="dr-bar-track" aria-hidden="true"><span className="dr-bar-fill" style={{ width: `${Math.round((100 * n) / max)}%` }} /></span>
              <span className="dr-bar-n">{num(n)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Section({ id, title, sub, right, children }) {
  return (
    <section className="dr-section stack g12" aria-labelledby={id}>
      <div className="dr-section-h">
        <div className="stack g4"><h2 id={id} className="dr-h2">{title}</h2>{sub && <span className="small muted">{sub}</span>}</div>
        {right}
      </div>
      {children}
    </section>
  );
}

function RunChip({ run }) {
  if (run.arrived && run.ok === false) return <span className="mchip mchip-bad" data-testid="dr-run">Failed · {when(run.at)}</span>;
  if (run.arrived) return <span className="mchip mchip-ok" data-testid="dr-run">Arrived · {when(run.at)}</span>;
  if (run.late) return <span className="mchip mchip-bad" data-testid="dr-run">No run by 7:00 AM · needs attention</span>;
  return <span className="mchip mchip-neutral" data-testid="dr-run">No run yet today</span>;
}

/** Is the collector's AI working? Today's summaries and API errors, Anthropic's last error, and "Test the AI now". */
function CollectorAi({ ai }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const a = ai || {};
  const test = async () => {
    setBusy(true);
    try {
      const out = await http('/api/admin/daily-report/ai-check', { method: 'POST' });
      setRes(out);
      toast(out.ok ? (out.summaryOk === false ? 'The AI answers, but the test summary failed a check' : 'The AI wrote a test summary: it works') : 'The AI test failed');
    } catch (e) {
      setRes({ ok: false, kind: 'request', error: e.message || 'The test could not run.' });
    } finally {
      setBusy(false);
    }
  };
  const bad = (a.errorsToday > 0 && !a.okToday) || a.paused;
  return (
    <div className="dr-tile" data-testid="dr-collector-ai">
      <span className="dr-tile-l">Collector AI</span>
      <span className="dr-tile-v">{a.okToday > 0 ? 'Working' : a.errorsToday > 0 ? 'Failing' : 'No calls yet today'}</span>
      <span className={`dr-delta dr-delta-${bad ? 'bad' : 'good'}`}>{num(a.okToday || 0)} written · {num(a.errorsToday || 0)} API errors today</span>
      {a.lastErrorKind && <span className="xs muted dr-wrap" data-testid="dr-ai-last-error">Last error {when(a.lastErrorAt)}: {a.lastErrorKind}{a.lastError ? ` — ${a.lastError}` : ''}</span>}
      <button type="button" className="btn btn-outline btn-sm" onClick={test} disabled={busy} aria-busy={busy} data-testid="dr-ai-test">{busy ? 'Testing…' : 'Test the AI now'}</button>
      {res && <span className={`small dr-wrap ${res.ok ? '' : 'dr-err'}`} role="status" data-testid="dr-ai-test-result">{res.ok ? (res.summaryOk === false ? `The key works (${res.model}), but the test summary failed the ${res.kind} check.` : `Works (${res.model}): a test summary was written.`) : `Failed: ${res.kind}${res.error ? ` — ${res.error}` : ''}`}</span>}
    </div>
  );
}

function RecentErrors({ rows }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="dr-bars stack g6" data-testid="dr-recent-errors">
      <h3 className="dr-h3">Today's server errors (latest first)</h3>
      <ul className="dr-err-list">
        {rows.map((e) => (
          <li key={`${e.at}-${e.rid}`} className="small dr-wrap"><span className="dr-mono">{e.method} {e.path}</span> · {e.error}{e.message ? `: ${e.message}` : ''} · {when(e.at)}</li>
        ))}
      </ul>
    </div>
  );
}

const MSTATE = { met: ['mchip-ok', 'Met'], miss: ['mchip-bad', 'Not met'], none: ['mchip-neutral', 'No data yet'] };
const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'];

function Report({ d }) {
  const m = d.metrics;
  const t = d.today || {};
  const col = t.collector || {};
  const vet = t.vetting || {};
  const payReady = t.payments ? t.payments.ready : null;
  const gh = d.health.github || { connected: false, runs: [] };
  const ai = t.ai || {};
  const aa = t.autoApply;
  return (
    <div className="stack g20">
      <div className="dr-top">
        <section className="glass dr-words stack g8" aria-labelledby="dr-words-h">
          <h2 id="dr-words-h" className="dr-h2">Today in plain words</h2>
          <ul className="dr-lines" data-testid="dr-summary">{d.summary.map((l) => <li key={l}>{l}</li>)}</ul>
        </section>
        <section className="dr-attn stack g8" aria-labelledby="dr-attn-h" data-testid="dr-attention">
          <h2 id="dr-attn-h" className="dr-h2">Needs attention</h2>
          {d.attention.length === 0 ? <span className="small muted">Nothing needs attention today.</span> : (
            <ul className="dr-attn-list">
              {d.attention.map((a) => (
                <li key={a.key} className={`dr-attn-item dr-attn-${a.level}`} data-testid="dr-attn-item">
                  <span className={`mchip ${a.level === 'bad' ? 'mchip-bad' : 'mchip-warn'}`}>{a.level === 'bad' ? 'Urgent' : 'Check'}</span>
                  <span className="dr-attn-text">{a.text}</span>
                  {a.link && <Link to={a.link} className="small">Open</Link>}
                </li>
              ))}
            </ul>
          )}
          {vet.switchOn === false && <span className="xs muted">For information: the vetting switch is OFF (new skill checks are hidden from the public).</span>}
        </section>
      </div>

      <Section id="dr-col" title="Job collector" right={<RunChip run={d.collectorRun} />}
        sub={col.fromRuns ? 'From the collector’s run reports.' : 'From nm7.si’s own records (the collector hasn’t sent run reports today).'}>
        <div className="dr-tiles">
          <Tile m={m} k="colSent" label="Jobs sent" />
          <Tile m={m} k="colCreated" label="New jobs created" />
          <Tile m={m} k="colUpdated" label="Jobs updated" />
          <Tile m={m} k="colReview" label="Sent to review" lower />
          <Tile m={m} k="colRejected" label="Rejected" lower />
          <Tile m={m} k="colClosed" label="Closed (link check)" />
          <Tile m={m} k="liveJobs" label="Live jobs on nm7.si" />
          <Tile m={m} k="reviewQueue" label="Review queue" lower to="/admin/jobs?tab=collector" note={`Needs attention above ${d.limits.reviewQueue}.`} />
        </div>
        <div className="dr-grid2">
          <Bars title="Why jobs went to review" rows={reasonList(col.reviewReasons)} empty="No jobs went to review today." />
          <Bars title="Why jobs were rejected" rows={reasonList(col.rejectedReasons)} empty="No jobs rejected today." />
          <Bars title="New jobs by city" rows={(col.byCity || []).map((r) => [r.name, r.n])} empty="No new jobs today." />
          <Bars title="New jobs by experience" rows={(col.byBand || []).map((r) => [bandWord(r.name), r.n])} empty="No new jobs today." />
        </div>
        {col.linkCheck && (col.linkCheck.checked > 0 || col.linkCheck.closed > 0) && (
          <span className="small muted" data-testid="dr-linkcheck">Link check: {num(col.linkCheck.checked)} links checked, {num(col.linkCheck.dead)} dead, {num(col.linkCheck.closed)} jobs closed.</span>
        )}
      </Section>

      <Section id="dr-health" title="Site health">
        <div className="dr-tiles">
          <div className="dr-tile" data-testid="dr-api">
            <span className="dr-tile-l">API</span>
            <span className="dr-tile-v">{d.health.up ? 'Up' : 'Down'}</span>
            <span className={`dr-delta dr-delta-${!d.health.up || d.health.dbMs > d.health.slowMs ? 'bad' : 'good'}`}>Database answered in {msText(d.health.dbMs)}</span>
            <Sparkline series={m.apiMs.series} fmt={msText} label="Database response time at each daily snapshot" />
          </div>
          <div className="dr-tile" data-testid="dr-deploy">
            <span className="dr-tile-l">Last deploy</span>
            <span className="dr-tile-v dr-mono">{shortCommit(d.health.commit)}</span>
            <span className="xs muted">Server running since {when(d.health.startedAt)}</span>
          </div>
          <div className="dr-tile" data-testid="dr-github">
            <span className="dr-tile-l">Nightly and smoke-live tests</span>
            {gh.connected ? (gh.runs.length ? (
              <ul className="dr-gh">{gh.runs.map((r) => (
                <li key={r.name}><span className={`mchip ${r.conclusion === 'success' ? 'mchip-ok' : r.conclusion === 'failure' ? 'mchip-bad' : 'mchip-neutral'}`}>{r.name}: {r.conclusion}</span></li>
              ))}</ul>
            ) : <span className="small muted">No runs found.</span>) : <span className="dr-tile-v dr-tile-none">Not connected</span>}
            {!gh.connected && <span className="xs muted">Set GITHUB_STATUS_TOKEN on the server to show them.</span>}
          </div>
          <Tile m={m} k="errors" label="Server errors" lower />
          <Tile m={m} k="aiUsed" label="AI calls used today" note={ai.cap ? `Daily allowance ${num(ai.cap)}` : undefined} />
          <Tile m={m} k="aiCollector" label="Collector AI summaries" note={ai.collectorLimit ? `Daily allowance ${num(ai.collectorLimit)}` : undefined} />
          <CollectorAi ai={d.collectorAi} />
        </div>
        <RecentErrors rows={d.recentErrors} />
      </Section>

      <Section id="dr-users" title="Users and business" sub="Demo accounts and demo colleges are never counted.">
        <div className="dr-tiles">
          <Tile m={m} k="signups" label="New sign-ups" note={`${num(m.signupSeekers.value)} job seekers · ${num(m.signupCompanies.value)} companies · ${num(m.signupColleges.value)} colleges`} />
          <Tile m={m} k="signupSeekers" label="Job seekers" />
          <Tile m={m} k="signupStudents" label="Students joined colleges" />
          <Tile m={m} k="signupCompanies" label="Companies" />
          <Tile m={m} k="signupColleges" label="Colleges" />
          <Tile m={m} k="activeUsers" label="Active users" note="Signed in and used the site today" />
          <Tile m={m} k="applications" label="Applications" />
          <Tile m={m} k="autoApplyUsers" label="Auto Apply runs" note={`${num(m.autoApplications.value)} applications by Auto Apply`} />
          <Tile m={m} k="companyJobs" label="Jobs posted by companies" />
          <Tile m={m} k="interviewsBooked" label="Interviews booked" />
          {payReady === false ? (
            <div className="dr-tile" data-testid="dr-payments-soon">
              <span className="dr-tile-l">Orders and revenue</span>
              <span className="dr-tile-v dr-tile-none">Payments coming soon</span>
              <span className="xs muted">Razorpay keys aren’t set on the server yet.</span>
            </div>
          ) : (
            <>
              <Tile m={m} k="paidOrders" label="Paid orders" />
              <Tile m={m} k="revenue" label="Revenue" fmt={inr} />
            </>
          )}
          <Tile m={m} k="refunds" label="Refunds" lower note={`${inr(m.refundAmount.value)} refunded`} />
        </div>
      </Section>

      <Section id="dr-vet" title="Vetting engine"
        right={<span className={`mchip ${vet.switchOn ? 'mchip-ok' : 'mchip-neutral'}`} data-testid="dr-switch">Vetting switch: {vet.switchOn ? 'ON' : 'OFF'}</span>}>
        <div className="dr-tiles">
          <Tile m={m} k="checksStarted" label="Skill checks started" />
          <Tile m={m} k="checksPassed" label="Skill checks passed" />
          <Tile m={m} k="passRate" label="Pass rate" fmt={pct} />
          <Tile m={m} k="readyNow" label="⚡ Ready now" />
          <Tile m={m} k="aiInterviews" label="AI interviews" />
          <Tile m={m} k="l4Checks" label="L4 checks requested" />
          <Tile m={m} k="appealsOpen" label="Appeals open" lower />
          <Tile m={m} k="fraudOpen" label="Fraud flags open" lower to="/admin/skill-tests?tab=fraud" />
        </div>
        <div className="dr-levels" data-testid="dr-levels">
          {LEVELS.map((l) => (
            <div key={l} className="dr-level"><span className="dr-level-l">{(vet.levels || []).find((x) => `L${x.level}` === l)?.label || l}</span><span className="dr-level-v">{num(m[l.toLowerCase()]?.value)}</span></div>
          ))}
        </div>
        <div className="stack g8">
          <h3 className="dr-h3">Success measures</h3>
          {(vet.measures || []).length === 0 ? <span className="small muted">No data yet.</span> : (
            <ul className="dr-measures" data-testid="dr-measures">
              {vet.measures.map((x) => (
                <li key={x.key} className="dr-measure" data-testid="dr-measure" data-state={x.state}>
                  <span className="dr-measure-l">{x.label}</span>
                  <span className="dr-measure-v">{x.value == null ? '—' : num(x.value)}<span className="xs muted"> / target {x.lowerIsBetter ? 'at most' : 'at least'} {num(x.target)}</span></span>
                  <span className={`mchip ${MSTATE[x.state][0]}`}>{MSTATE[x.state][1]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <Section id="dr-aa-h" title="Auto Apply" sub="Auto Apply 2.0 by channel, last 7 days (rates over 30 days). Demo accounts are never counted."
        right={aa ? <span className={`mchip ${aa.switchOn ? 'mchip-ok' : 'mchip-neutral'}`} data-testid="dr-aa-switch">Auto Apply 2.0: {aa.switchOn ? 'public' : 'testers only'}</span> : null}>
        <Suspense fallback={<Spinner />}><AutoApplyNumbers aa={aa} /></Suspense>
      </Section>
    </div>
  );
}

export default function DailyReport() {
  const toast = useToast();
  const [st, setSt] = useState({ data: null, error: null, loading: true });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setSt((s) => ({ ...s, loading: true, error: null }));
    http('/api/admin/daily-report').then((data) => setSt({ data, error: null, loading: false }), (error) => setSt({ data: null, error, loading: false }));
  }, []);
  useEffect(() => { load(); }, [load]);
  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await http('/api/admin/daily-report/refresh', { method: 'POST' });
      setSt({ data, error: null, loading: false });
      toast('Report refreshed');
    } catch (e) {
      toast(e.message || 'That didn’t work. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const d = st.data;
  const updated = d?.today?.at;
  return (
    <div className="stack g20 dr-page">
      <div className="dr-head">
        <div className="stack g4">
          <h1 className="display dr-h1">Daily report</h1>
          <span className="small muted" data-testid="dr-updated">
            {d ? (updated ? `Updated ${when(updated)}` : 'Not computed yet') : 'Loading…'} · runs every day at 6:30 AM IST
          </span>
        </div>
        <button type="button" className="btn btn-primary dr-refresh" onClick={refresh} disabled={busy} aria-busy={busy} data-testid="dr-refresh">
          {busy ? <><Spinner /> Refreshing…</> : 'Refresh now'}
        </button>
      </div>
      {st.loading && !d && <div className="row g12 muted" role="status" style={{ padding: 24 }}><Spinner /> Loading…</div>}
      {st.error && (
        <div className="card stack g8" role="alert">
          <strong>{st.error.status === 403 ? 'No access' : 'Couldn’t load the report'}</strong>
          <span className="small muted">{st.error.message}</span>
          {st.error.status !== 403 && <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={load}>Try again</button>}
        </div>
      )}
      {d && d.busy && <div className="well small" role="status">Another big job is running on the server. Today’s numbers appear in a minute (press Refresh now).</div>}
      {d && <Report d={d} />}
    </div>
  );
}
