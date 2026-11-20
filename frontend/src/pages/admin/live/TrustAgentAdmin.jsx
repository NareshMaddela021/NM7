// Admin -> Skill checks -> Vetting Trust -> Calls & WhatsApp (T5; every change audited). /api/admin/trust/agent
//   Providers: WhatsApp (test provider or Meta Cloud API) and AI calls (test provider or Bolna), each key set / not set
//   (never the value: docs/trust/T5-vendors.md), and the webhook URLs to give Meta and Bolna.
//   Rules: people per job, contacts per person a day, quiet hours (IST), hours before the AI call, when a conversation
//   with no reply closes, the lowest match score.
//   Templates: the WhatsApp template in English / Hindi / Telugu to submit to Meta (UTILITY), each marked approved once
//   Meta approves it (a real provider only sends approved ones), and the AI call script.
//   Counts (24 hours / 30 days: sent, replied, calls, minutes, booked, opt-outs), the latest conversations, the log, and
//   the test console: play the candidate's side (a button, a typed reply or a call result) with the test providers.
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { Loading, http, useAction, useApi, when } from './common';

const NUMS = [['perJob', 'People per job', 1, 200], ['perPersonDay', 'New contacts a person a day', 1, 5], ['callAfterHours', 'AI call after no reply (hours)', 1, 48],
  ['closeAfterHours', 'Close with no reply after (hours)', 12, 240], ['minScore', 'Lowest match score (0–100)', 0, 100]];
const COUNTS = [['sent', 'WhatsApp sent'], ['replied', 'Replied'], ['calls', 'AI calls'], ['callMinutes', 'Call minutes'], ['booked', 'Interviews booked'], ['optOuts', 'Opt-outs']];

function Console({ d, reload }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [id, setId] = useState('');
  const [text, setText] = useState('');
  const open = d.conversations.filter((c) => ['asked', 'knockout', 'slots', 'calling'].includes(c.state));
  useEffect(() => { if (!open.some((c) => c.id === id)) setId(open[0]?.id || ''); }, [d.conversations]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open.length) return <p className="small muted" style={{ margin: 0 }}>Test console: no open conversation yet.</p>;
  const send = (body) => run(async () => { const r = await http('/api/admin/trust/agent/simulate', { method: 'POST', body: { convoId: id, ...body } }); setText(''); reload(); return r; }, 'Sent as the candidate');
  const cur = open.find((c) => c.id === id);
  return (
    <div className="stack g8" data-testid="ta-console">
      <h3 className="h4" style={{ margin: 0 }}>Test console (test providers only)</h3>
      <div className="field"><label className="label" htmlFor="ta-c">Conversation</label>
        <select id="ta-c" className="input" value={id} onChange={(e) => setId(e.target.value)} data-testid="ta-convo">{open.map((c) => <option key={c.id} value={c.id}>{c.user} · {c.job} · {c.state}</option>)}</select></div>
      {cur?.state === 'calling' ? (
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={() => send({ call: { status: 'completed', interest: 'interested', knockouts: {}, slot: 1, transcript: [{ who: 'agent', text: 'Hello, this is Nm7’s AI assistant.' }, { who: 'candidate', text: 'Yes, interested.' }] } })} data-testid="ta-call-yes">Call: interested, time 1</button>
          <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={() => send({ call: { status: 'no_answer' } })}>Call: no answer</button>
        </div>
      ) : (
        <>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            {['interested', 'not_now', 'yes', 'no', 'slot:1', 'stop'].map((b) => <button key={b} type="button" className="btn btn-outline btn-sm" style={{ minHeight: 44 }} disabled={busy} onClick={() => send({ button: b })} data-testid={`ta-btn-${b.replace(':', '')}`}>{b}</button>)}
          </div>
          <form className="row g8" style={{ flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); if (text.trim()) send({ text }); }}>
            <input className="input" style={{ flex: '1 1 200px' }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a reply (e.g. haan, band karo, 2)" aria-label="A typed reply" data-testid="ta-text" />
            <button type="submit" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy} data-testid="ta-send">Send</button>
          </form>
        </>
      )}
    </div>
  );
}

export default function TrustAgentAdmin() {
  const st = useApi('/api/admin/trust/agent');
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(null);
  useEffect(() => { if (st.data) setF({ ...st.data.settings }); }, [st.data]);
  return (
    <section className="card stack g12" aria-labelledby="ta-h" data-testid="ta-card">
      <h2 id="ta-h" className="h3" style={{ margin: 0 }}>Calls & WhatsApp</h2>
      <Loading st={st}>{(d) => {
        if (!f) return null;
        const save = (extra = {}) => run(async () => { await http('/api/admin/trust/agent', { method: 'PUT', body: { ...f, ...Object.fromEntries(NUMS.map(([k]) => [k, Number(f[k])])), ...extra } }); st.reload(); }, 'Saved');
        const runNow = () => run(async () => { const r = await http('/api/admin/trust/agent/run', { method: 'POST' }); toast(`Ran: ${Object.entries(r.ran).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing due'}`); st.reload(); });
        const prov = (kind, key) => d.providers[kind].find((p) => p.key === key);
        return (
          <>
            <p className="small" style={{ margin: 0 }}>When a company turns on “Call / message matching candidates” for a job, Nm7 messages the best matches who agreed on WhatsApp first, calls with an AI assistant if they allowed calls and didn’t reply, asks the job’s yes/no questions and books an interview time. Stop in any language turns that channel off at once. {d.public ? 'Live for everyone.' : 'While Vetting Trust is hidden: only testers, admins and the demo company, and only test companies.'}</p>
            <div className="row g12" style={{ flexWrap: 'wrap' }}>
              {[['whatsapp', 'whatsappProvider', 'WhatsApp'], ['voice', 'voiceProvider', 'AI calls']].map(([kind, k, label]) => {
                const p = prov(kind, f[k]);
                return (
                  <div key={kind} className="stack g4" style={{ flex: '1 1 260px', minWidth: 0 }}>
                    <div className="field"><label className="label" htmlFor={`ta-${kind}`}>{label}</label>
                      <select id={`ta-${kind}`} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`ta-${kind}`}>{d.providers[kind].map((x) => <option key={x.key} value={x.key}>{x.label}{x.test || x.ready ? '' : ' (keys not set)'}</option>)}</select></div>
                    <span className={`mchip ${p?.test ? 'mchip-warn' : p?.ready ? 'mchip-ok' : 'mchip-bad'}`} role="status" data-testid={`ta-${kind}-state`}>{p?.test ? 'Test mode: nothing real is sent' : p?.ready ? 'Connected' : 'Keys not set: nobody is contacted'}</span>
                    {!p?.test && <span className="xs" style={{ overflowWrap: 'anywhere' }}>{Object.entries(p?.keys || {}).map(([n, ok]) => `${n}: ${ok ? 'set' : 'not set'}`).join(' · ')}</span>}
                  </div>
                );
              })}
            </div>
            <span className="xs muted" style={{ overflowWrap: 'anywhere' }}>Webhooks: WhatsApp {d.webhooks.whatsapp} · calls {d.webhooks.voice}</span>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: '1 1 140px' }}><label className="label" htmlFor="ta-qf">Quiet from (IST)</label><input id="ta-qf" type="time" className="input" value={f.quietFrom} onChange={(e) => setF({ ...f, quietFrom: e.target.value })} data-testid="ta-quiet-from" /></div>
              <div className="field" style={{ flex: '1 1 140px' }}><label className="label" htmlFor="ta-qt">Quiet until (IST)</label><input id="ta-qt" type="time" className="input" value={f.quietTo} onChange={(e) => setF({ ...f, quietTo: e.target.value })} data-testid="ta-quiet-to" /></div>
              {NUMS.map(([k, l, lo, hi]) => (
                <div key={k} className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor={`ta-${k}`}>{l}</label>
                  <input id={`ta-${k}`} type="number" min={lo} max={hi} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`ta-${k}`} /></div>
              ))}
            </div>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy} onClick={() => save()} data-testid="ta-save">Save</button>
              <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={runNow} data-testid="ta-run">Run a pass now</button>
            </div>
            <div className="table-wrap mtable-wrap vt-scroll">
              <table className="table mtable vt-table" data-testid="ta-counts">
                <thead><tr><th>Count</th><th>24 hours</th><th>30 days</th></tr></thead>
                <tbody>{COUNTS.map(([k, l]) => <tr key={k}><th scope="row" className="small">{l}</th><td data-label="24 hours" className="num" data-testid={`ta-today-${k}`}>{d.counts.today[k]}</td><td data-label="30 days" className="num">{d.counts.d30[k]}</td></tr>)}</tbody>
              </table>
            </div>
            <details data-testid="ta-templates">
              <summary className="small"><strong>WhatsApp templates to submit to Meta</strong> (name {d.templates[0].name}, category UTILITY) and the call script</summary>
              <div className="stack g8" style={{ marginTop: 8 }}>
                {d.templates.map((t) => (
                  <div key={t.lang} className="card stack g4" style={{ minWidth: 0 }}>
                    <strong className="small">{t.language}</strong>
                    <span className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{t.body}</span>
                    <span className="xs muted">Buttons: {t.buttons.join(' · ')} · Footer: {t.footer}</span>
                    <label className="row g8" style={{ alignItems: 'center', minHeight: 44 }}><input type="checkbox" checked={!!f.approved?.[t.lang]} onChange={(e) => setF({ ...f, approved: { ...f.approved, [t.lang]: e.target.checked } })} data-testid={`ta-approved-${t.lang}`} /> <span className="small">Meta approved it</span></label>
                  </div>
                ))}
                {Object.entries(d.callScript).map(([lang, s]) => <span key={lang} className="xs" style={{ overflowWrap: 'anywhere' }}><strong>Call ({lang}):</strong> {s.intro}</span>)}
              </div>
            </details>
            <Console d={d} reload={st.reload} />
            <details data-testid="ta-log">
              <summary className="small"><strong>Latest conversations and log</strong> ({d.open} open)</summary>
              <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>{d.conversations.map((c) => <li key={c.id} style={{ overflowWrap: 'anywhere' }} data-testid="ta-convo-row">{c.user} · {c.job} · <strong>{c.state}</strong> · score {c.score ?? '—'} · {when(c.at)}</li>)}</ul>
              <ul className="xs" style={{ margin: '8px 0 0', paddingLeft: 18 }}>{d.log.map((e, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>{when(e.at)} · {e.kind} · {e.user} · {e.job}{e.detail ? ` · ${e.detail}` : ''}</li>)}</ul>
            </details>
          </>
        );
      }}</Loading>
    </section>
  );
}
