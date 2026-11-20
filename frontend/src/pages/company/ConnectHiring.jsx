// Auto Apply 2.0, phase A4, on the company dashboard: "Connect your hiring system" (Zoho Recruit, Greenhouse, Lever,
// Darwinbox; a no-network test system on test servers). Shown only to companies the 2.0 switch lets in. Main and full
// admins choose the system, paste their own key (and board / site / region / subdomain), and Nm7 tests it with the
// system before saving it encrypted; afterwards only "•••• last 4" and the dates come back, never the key. Test
// connection and Disconnect (asked on the page, no browser dialogs). Then each Nm7 job can be linked to a job in the
// hiring system, so Auto Apply applications to it are delivered there too (they always stay in the Nm7 dashboard).
// English only while it is tested. Everything wraps at 390 px.
import { useCallback, useEffect, useState } from 'react';
import { rq } from '../../lib/company';
import { Chip, Empty, Skel } from '../me/kit';

const when = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const WRAP = { overflowWrap: 'anywhere', minWidth: 0 };

export default function ConnectHiring({ c }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => rq(`/api/company/${c.id}/ats`).then((x) => { setD(x); setErr(''); }, (e) => { setD(false); setErr(e.message); }), [c.id]);
  useEffect(() => { load(); }, [load]);
  if (d === null) return <Skel cards={1} lines={4} label="Loading" />;
  if (d === false) return <Empty compact shape="sphere" tint="company" title="Not available">{err}</Empty>;
  return (
    <section className="mstack" aria-label="Connect your hiring system" data-testid="ats-page">
      <p className="small muted" style={{ margin: 0 }}>
        When Auto Apply sends an application to one of your linked jobs, Nm7 also delivers it to your own hiring system, with the tailored resume, the cover note and the screening answers. Every application stays in your Nm7 dashboard too, so nothing is lost if your system is down.
      </p>
      {d.connection ? <Connected c={c} d={d} onChanged={setD} /> : <ConnectForm c={c} d={d} onChanged={setD} />}
      {d.connection && <Jobs c={c} d={d} onChanged={load} />}
    </section>
  );
}

function Connected({ c, d, onChanged }) {
  const x = d.connection;
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const [msg, setMsg] = useState(null);
  const act = async (path, method, ok) => {
    setBusy(true); setMsg(null);
    try { const r = await rq(path, { method }); onChanged(r); setMsg({ ok: true, text: ok(r) }); setAsk(false); } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  return (
    <div className="mcard stack g8" data-testid="ats-connected">
      <div className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <strong data-testid="ats-name" style={WRAP}>{x.name}</strong>
        <Chip tone={x.lastError && !x.testOk ? 'warn' : 'ok'} testid="ats-state">{x.demo ? 'Connected (demo)' : 'Connected'}</Chip>
      </div>
      <dl className="ats-facts">
        <div><dt>Key</dt><dd className="mono" data-testid="ats-last4">{x.demo ? 'demo, no key' : `•••• ${x.last4 || '••••'}`}</dd></div>
        <div><dt>Connected</dt><dd data-testid="ats-connected-at">{when(x.connectedAt)}</dd></div>
        {Object.entries(x.settings || {}).map(([k, v]) => <div key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd style={WRAP}>{v}</dd></div>)}
        <div><dt>Last test</dt><dd data-testid="ats-tested">{x.testedAt ? `${x.testOk ? 'Worked' : 'Failed'} · ${when(x.testedAt)}` : 'Not yet'}</dd></div>
        <div><dt>Statuses read back</dt><dd>{x.demo ? 'Demo' : x.statusReadable ? `Yes${x.lastSyncAt ? ` · last ${when(x.lastSyncAt)}` : ''}` : 'No (add the optional status key to read them)'}</dd></div>
        <div><dt>Delivered today</dt><dd data-testid="ats-today">{d.counts.today}</dd></div>
        <div><dt>Waiting / kept on Nm7</dt><dd>{d.counts.waiting} / {d.counts.kept}</dd></div>
      </dl>
      {x.lastError && <p className="xs" style={{ margin: 0, color: 'var(--danger)' }} data-testid="ats-last-error">Last problem ({when(x.lastError.at)}): {x.lastError.message}</p>}
      {d.canManage ? (
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => act(`/api/company/${c.id}/ats/test`, 'POST', () => 'The connection works.')} data-testid="ats-test">Test connection</button>
          {!ask && <button type="button" className="link-btn small" disabled={busy} onClick={() => setAsk(true)} data-testid="ats-disconnect">Disconnect</button>}
        </div>
      ) : <p className="xs muted" style={{ margin: 0 }}>Only the main and full admins can change the connection.</p>}
      {ask && (
        <div className="mcard mcard-warn mcard-tight" role="alert">
          <span className="small">Disconnect {x.name}? Nm7 deletes the key at once. Applications still waiting stay in your Nm7 dashboard.</span>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-signal btn-sm" disabled={busy} onClick={() => act(`/api/company/${c.id}/ats`, 'DELETE', () => 'Disconnected. The key is deleted.')} data-testid="ats-disconnect-yes">Disconnect</button>
            <button type="button" className="link-btn small" onClick={() => setAsk(false)}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <p className={msg.ok ? 'small' : 'error'} role={msg.ok ? 'status' : 'alert'} style={{ margin: 0 }} data-testid="ats-msg">{msg.text}</p>}
    </div>
  );
}

function ConnectForm({ c, d, onChanged }) {
  const [partner, setPartner] = useState('');
  const [v, setV] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const p = d.partners.find((x) => x.key === partner);
  if (!d.canManage) return <Empty compact shape="sphere" tint="company" title="No hiring system connected">The main or a full admin of your team can connect one.</Empty>;
  const pick = (k) => {
    const next = d.partners.find((x) => x.key === k);
    setPartner(k); setErr('');
    setV(Object.fromEntries((next?.fields || []).filter((f) => f.options).map((f) => [f.key, f.options[0].value])));
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { const r = await rq(`/api/company/${c.id}/ats/connect`, { method: 'POST', body: { partner, fields: v } }); setV({}); onChanged(r); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form className="mcard stack g12" onSubmit={submit} aria-label="Connect a hiring system" data-testid="ats-form" autoComplete="off">
      <div className="field"><label className="label" htmlFor="ats-partner">Your hiring system</label>
        <select id="ats-partner" className="input" value={partner} onChange={(e) => pick(e.target.value)} data-testid="ats-partner">
          <option value="">Choose…</option>
          {d.partners.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
        </select></div>
      {p && (
        <>
          <p className="xs muted" style={{ margin: 0, ...WRAP }} data-testid="ats-how">{p.how}</p>
          {!p.confirmed && <p className="xs" style={{ margin: 0 }} data-testid="ats-unconfirmed">Darwinbox’s API is set up from the shape we could find and is waiting for Darwinbox to confirm it. Talk to Nm7 before relying on it.</p>}
          {p.fields.map((f) => (
            <div key={f.key} className="field">
              <label className="label" htmlFor={`ats-f-${f.key}`}>{f.label}</label>
              {f.options ? (
                <select id={`ats-f-${f.key}`} className="input" value={v[f.key] || ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}>
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input id={`ats-f-${f.key}`} className="input" type={f.secret ? 'password' : 'text'} autoComplete={f.secret ? 'new-password' : 'off'} spellCheck={false}
                  required={f.required} value={v[f.key] || ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value.trim() })} data-testid={`ats-f-${f.key}`} />
              )}
              {f.help && <span className="xs muted" style={WRAP}>{f.help}</span>}
            </div>
          ))}
          <span className="xs muted">Nm7 tests the details with {p.name} first. The key is stored encrypted and is never shown again: you’ll only see its last 4 characters.</span>
          <button type="submit" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="ats-connect">Test and connect</button>
        </>
      )}
      {err && <p className="error" role="alert" style={{ margin: 0 }} data-testid="ats-error">{err}</p>}
    </form>
  );
}

function Jobs({ c, d, onChanged }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState({});
  const fetchJobs = async () => {
    setBusy(true); setErr('');
    try { setList((await rq(`/api/company/${c.id}/ats/jobs`)).jobs); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const save = async (jid, pj) => {
    setBusy(true); setErr('');
    try { await rq(`/api/company/${c.id}/jobs/${jid}/ats`, { method: 'PUT', body: { partnerJob: pj } }); await onChanged(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="mcard stack g8" data-testid="ats-jobs">
      <strong className="small">Link your Nm7 jobs</strong>
      <span className="xs muted">Auto Apply applications to a linked job are delivered to the job you pick in {d.connection.name}.</span>
      {d.jobs.length === 0 && <span className="small muted">No open jobs that take applications on Nm7.</span>}
      {d.canLink && d.jobs.length > 0 && !list && <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={fetchJobs} data-testid="ats-load-jobs">Load jobs from {d.connection.name}</button>}
      <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {d.jobs.map((j) => (
          <li key={j.id} className="ats-job" data-testid="ats-job">
            <span className="small" style={WRAP}><strong>{j.title}</strong>{' '}
              <span className="muted" data-testid="ats-job-link">{j.link ? `· linked to ${j.link.title || j.link.id}` : '· not linked'}</span></span>
            {d.canLink && list && (
              <span className="row g8" style={{ flexWrap: 'wrap', minWidth: 0 }}>
                <select className="input ats-select" aria-label={`Job in ${d.connection.name} for ${j.title}`} value={pick[j.id] ?? j.link?.id ?? ''} onChange={(e) => setPick({ ...pick, [j.id]: e.target.value })} data-testid="ats-job-pick">
                  <option value="">Not linked</option>
                  {list.map((x) => <option key={x.id} value={x.id}>{x.title}{x.location ? ` · ${x.location}` : ''}</option>)}
                </select>
                <button type="button" className="btn btn-outline btn-sm" disabled={busy || (pick[j.id] ?? j.link?.id ?? '') === (j.link?.id ?? '')}
                  onClick={() => { const id = pick[j.id]; const x = list.find((y) => y.id === id); save(j.id, x ? { id: x.id, title: x.title } : null); }} data-testid="ats-job-save">Save</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
    </div>
  );
}
