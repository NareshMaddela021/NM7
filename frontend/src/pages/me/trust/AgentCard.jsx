// Profile & settings → Calls & WhatsApp (Vetting Trust T5). Rendered by PrivacyConsent (same lazy chunk), so only for
// people who get Vetting Trust. GET/PUT /api/me/trust/agent. When a company posts a job that fits, Nm7 may message the
// person on WhatsApp and, only if they allow calls and don't reply, call with an AI voice assistant. Here they choose
// the channels, the language (English / Hindi / Telugu) and quiet days, see a Stop they sent (and turn the channel back
// on), and read "What we said": every message and call transcript we kept (no recordings). Needs the T1 consent
// "Calls and WhatsApp about matching jobs" (agreeing is one tap here). English only while it is tested.
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { http } from '../../../services/http';
import { MeCard } from '../kit';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmt = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const hm = (s) => { const [h, m] = s.split(':').map(Number); return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };

function Said({ c }) {
  return (
    <details data-testid="ag-said-item" style={{ minWidth: 0 }}>
      <summary className="small"><strong>{c.role}</strong>{c.company ? ` · ${c.company}` : ''} <span className="xs muted">· {c.stateText} · {fmt(c.at)}</span></summary>
      {c.lines.length === 0 ? <p className="xs muted" style={{ margin: '8px 0 0' }}>Nothing kept for this one.</p> : (
        <ol aria-label={`What we said about ${c.role}`} style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 8 }}>
          {c.lines.map((l, i) => (
            <li key={i} data-testid={`ag-line-${l.who}`} style={{ display: 'grid', gap: 2, padding: '8px 10px', borderRadius: 'var(--r-control)', background: l.who === 'nm7' ? 'var(--sunken)' : 'var(--surface)', border: '1px solid var(--border)', marginLeft: l.who === 'nm7' ? 0 : 24, minWidth: 0 }}>
              <span className="xs muted">{l.who === 'nm7' ? 'Nm7' : 'You'} · {l.channel === 'call' ? 'AI call' : 'WhatsApp'} · {fmt(l.at)}</span>
              <span className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{l.text}</span>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

export default function AgentCard() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(() => http('/api/me/trust/agent').then((x) => { setD(x); setF({ whatsapp: x.whatsapp, call: x.call, lang: x.lang, quietDays: x.quietDays }); }, () => setD(null)), []);
  useEffect(() => {
    load();
    window.addEventListener('trust-consent', load);
    return () => window.removeEventListener('trust-consent', load);
  }, [load]);
  if (!d || !f) return null;
  const agreed = d.consent === 'granted';
  const save = async (next = f) => {
    setBusy(true); setErr('');
    try { const x = await http('/api/me/trust/agent', { method: 'PUT', body: next }); setD(x); setF({ whatsapp: x.whatsapp, call: x.call, lang: x.lang, quietDays: x.quietDays }); toast('Saved'); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const agree = async () => {
    setBusy(true); setErr('');
    try {
      await http('/api/me/trust/consents/calls_whatsapp', { method: 'POST' });
      window.dispatchEvent(new Event('trust-consent'));
      if (d.phone) await save({ ...f, whatsapp: true });
      else await load();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const day = (i) => setF({ ...f, quietDays: f.quietDays.includes(i) ? f.quietDays.filter((x) => x !== i) : [...f.quietDays, i] });
  return (
    <MeCard as="section" id="s-calls" className="acc-sec" label="Calls and WhatsApp" icon="💬" title="Calls & WhatsApp" testid="ag-card"
      sub={`When a company posts a job that fits you, Nm7 can message you on WhatsApp (and call you with an AI assistant if you allow it) to ask if you're interested and book an interview. Never between ${hm(d.quiet.from)} and ${hm(d.quiet.to)}, at most ${d.perDay} a day. Reply STOP any time.`}>
      {!agreed ? (
        <div className="stack g8" data-testid="ag-consent">
          <p className="small" style={{ margin: 0 }}>{d.consentText}</p>
          <div><button type="button" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy} onClick={agree} data-testid="ag-agree">I agree: contact me about matching jobs</button></div>
        </div>
      ) : (
        <form className="stack g12" onSubmit={(e) => { e.preventDefault(); save(); }} aria-label="Calls and WhatsApp choices">
          <span className="small" data-testid="ag-phone">{d.phone ? <>We use <strong>{d.phone}</strong> (change it in Profile).</> : <>Add your mobile number in <a href="#s-profile">Profile</a> first.</>}</span>
          <fieldset className="stack g8" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">How we may reach you</legend>
            <label className="row g8" style={{ alignItems: 'center', minHeight: 44 }}><input type="checkbox" checked={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.checked })} data-testid="ag-wa" /> WhatsApp messages{d.optedOut.whatsapp && !f.whatsapp ? <span className="mchip mchip-warn" data-testid="ag-wa-stopped">You said Stop on {fmt(d.optedOut.whatsapp)}</span> : null}</label>
            <label className="row g8" style={{ alignItems: 'center', minHeight: 44 }}><input type="checkbox" checked={f.call} onChange={(e) => setF({ ...f, call: e.target.checked })} data-testid="ag-call" /> AI phone calls, if I don’t reply on WhatsApp{d.optedOut.call && !f.call ? <span className="mchip mchip-warn" data-testid="ag-call-stopped">You said stop on a call, {fmt(d.optedOut.call)}</span> : null}</label>
          </fieldset>
          <label className="field stack g4" style={{ maxWidth: 320 }}>
            <span className="label">Language</span>
            <select className="input" value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })} data-testid="ag-lang" style={{ minHeight: 44 }}>
              {d.langs.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
          </label>
          <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Quiet days (no messages or calls)</legend>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              {DAYS.map((n, i) => (
                <label key={n} className={`mchip ${f.quietDays.includes(i) ? 'mchip-accent' : 'mchip-neutral'}`} style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={f.quietDays.includes(i)} onChange={() => day(i)} data-testid={`ag-day-${i}`} />{n}
                </label>
              ))}
            </div>
          </fieldset>
          {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy} data-testid="ag-save">Save</button>
            {(d.whatsapp || d.call) && <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={() => save({ ...f, whatsapp: false, call: false })} data-testid="ag-stop-all">Stop all calls and messages</button>}
          </div>
          <span className="xs muted">To stop everything and delete what we kept, take back “Calls and WhatsApp about matching jobs” in Privacy & consent.</span>
        </form>
      )}
      {!agreed && err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <div className="stack g8" data-testid="ag-said">
        <h3 className="h4" style={{ margin: 0 }}>What we said</h3>
        {d.conversations.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Nothing yet. Messages and call transcripts show here (we never keep recordings).</p>
          : d.conversations.map((c) => <Said key={c.id} c={c} />)}
      </div>
    </MeCard>
  );
}
