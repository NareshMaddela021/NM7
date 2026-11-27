// /me/auto-apply/v2?tab=ready — Auto Apply 2.0, phase A6 ("One tap"): the jobs Nm7 can't send for the candidate,
// each with an apply kit (the tailored resume PDF to download or share, the cover note, the ready answers and their
// own details, every one with a Copy button) and the job's apply link. "Apply now" opens the company's page in a new
// tab and keeps the kit open here beside it; "I applied" moves the tracker to Applied (One tap); "Not applying" hides
// it. A job that closed after it was listed shows as Closed. Copy mode (phones): one field at a time, big buttons.
// The Nm7 Apply helper panel makes the short pairing code for the Chrome extension and signs browsers out.
// Part of the Auto Apply 2.0 page chunk (no new route, nothing in the Easy dashboard bundle). No pop-up dialogs;
// nothing scrolls sideways at 390 px.
import { useCallback, useEffect, useState } from 'react';
import { API_BASE, http } from '../../services/http';
import { Chip, Empty, Skel } from './kit';
import { IcCheck } from '../../components/icons';

const BASE = '/api/me/auto-apply/v2';

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

async function pdfFile(id) {
  const r = await fetch(`${API_BASE}${BASE}/onetap/${id}/resume.pdf`, { credentials: 'include' });
  if (!r.ok) throw new Error('The resume couldn’t be made right now. Try again in a minute.');
  const name = (/filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '') || [])[1] || 'Resume.pdf';
  return new File([await r.blob()], name, { type: 'application/pdf' });
}

function saveFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function CopyButton({ value, label, toast, big }) {
  const [done, setDone] = useState(false);
  const go = async () => {
    const ok = await copyText(value);
    toast(ok ? `Copied${label ? `: ${label}` : ''}` : 'Couldn’t copy. Press and hold the text to copy it.');
    if (ok) { setDone(true); setTimeout(() => setDone(false), 1500); }
  };
  return (
    <button type="button" className={big ? 'btn btn-signal aa2-copybig' : 'btn btn-outline btn-sm aa2-copy'} onClick={go} aria-label={label ? `Copy ${label}` : 'Copy'} data-testid="aa2-copy">
      {done ? <><IcCheck size={16} /> Copied</> : 'Copy'}
    </button>
  );
}

function ResumeButtons({ kit, toast }) {
  const [busy, setBusy] = useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';
  const run = async (share) => {
    setBusy(true);
    try {
      const file = await pdfFile(kit.id);
      if (share && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: file.name }); } catch { /* the candidate closed the share sheet */ }
      } else {
        saveFile(file);
        toast('Saved to your downloads');
      }
    } catch (x) { toast(x.message); } finally { setBusy(false); }
  };
  if (!kit.resume) return <p className="xs muted" style={{ margin: 0 }}>No tailored resume for this job yet.</p>;
  return (
    <div className="row g8 aa2-actions">
      <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run(false)} data-testid="aa2-kit-pdf">Download resume (PDF)</button>
      {canShare && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run(true)} data-testid="aa2-kit-share">Share resume</button>}
      <span className="xs muted aa2-wrap">{kit.resume.name}</span>
    </div>
  );
}

// every piece of the kit as one list, for copy mode
function pieces(kit) {
  return [
    ...kit.fields.map((f) => ({ key: f.key, label: f.label, value: f.value })),
    ...(kit.coverNote ? [{ key: 'cover', label: 'Cover note', value: kit.coverNote }] : []),
    ...kit.answers.map((a, i) => ({ key: `answer-${i}`, label: a.question, value: a.answer })),
  ];
}

function CopyMode({ kit, toast, onClose }) {
  const list = pieces(kit);
  const [i, setI] = useState(0);
  if (!list.length) return null;
  const p = list[Math.min(i, list.length - 1)];
  return (
    <section className="mcard mcard-tight stack g12 aa2-copymode" aria-label="Copy one at a time" data-testid="aa2-copymode">
      <div className="aa2-bar">
        <span className="xs muted" data-testid="aa2-copymode-step">{i + 1} of {list.length}</span>
        <button type="button" className="link-btn small" onClick={onClose} data-testid="aa2-copymode-close">Show the whole kit</button>
      </div>
      <strong className="small" data-testid="aa2-copymode-label">{p.label}</strong>
      <p className={`aa2-note aa2-copyvalue ${p.value.length > 120 ? 'aa2-pre small' : ''}`} data-testid="aa2-copymode-value">{p.value}</p>
      <CopyButton value={p.value} label={p.label} toast={toast} big />
      <div className="aa2-copynav">
        <button type="button" className="btn btn-outline" disabled={i === 0} onClick={() => setI(i - 1)} data-testid="aa2-copymode-back">‹ Back</button>
        <button type="button" className="btn btn-outline" disabled={i >= list.length - 1} onClick={() => setI(i + 1)} data-testid="aa2-copymode-next">Next ›</button>
      </div>
      <span className="xs muted">Copy, switch to the company’s page, paste into the matching box, come back for the next one.</span>
    </section>
  );
}

function Kit({ id, toast }) {
  const [kit, setKit] = useState(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState(() => (typeof window !== 'undefined' && window.innerWidth <= 480 ? 'one' : 'all'));
  useEffect(() => { http(`${BASE}/onetap/${id}/kit`).then(setKit, (x) => setErr(x.message)); }, [id]);
  if (err) return <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>;
  if (!kit) return <Skel cards={1} lines={3} />;
  return (
    <div className="stack g12 aa2-kit" data-testid="aa2-kit">
      <ResumeButtons kit={kit} toast={toast} />
      {mode === 'one' ? <CopyMode kit={kit} toast={toast} onClose={() => setMode('all')} /> : (
        <>
          <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMode('one')} data-testid="aa2-copymode-open">Copy one at a time (phone)</button>
          {kit.coverNote && (
            <section className="stack g4" aria-label="Cover note">
              <div className="aa2-bar"><strong className="small">Cover note</strong><CopyButton value={kit.coverNote} label="cover note" toast={toast} /></div>
              <p className="aa2-note aa2-pre small" style={{ margin: 0 }} data-testid="aa2-kit-cover">{kit.coverNote}</p>
            </section>
          )}
          {kit.answers.length > 0 && (
            <section className="stack g8" aria-label="Ready answers">
              <strong className="small">Ready answers</strong>
              <ul className="stack g8 aa2-list">
                {kit.answers.map((a) => (
                  <li key={a.question} className="aa2-kitrow" data-testid="aa2-kit-answer">
                    <span className="stack g4"><span className="xs muted">{a.question}</span><span className="small aa2-wrap">{a.answer}</span></span>
                    <CopyButton value={a.answer} label={a.question} toast={toast} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {kit.fields.length > 0 && (
            <section className="stack g8" aria-label="Your details">
              <strong className="small">Your details</strong>
              <ul className="stack g8 aa2-list">
                {kit.fields.map((f) => (
                  <li key={f.key} className="aa2-kitrow" data-testid="aa2-kit-field" data-key={f.key}>
                    <span className="stack g4"><span className="xs muted">{f.label}</span><span className="small aa2-wrap">{f.value}</span></span>
                    <CopyButton value={f.value} label={f.label} toast={toast} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <p className="xs muted" style={{ margin: 0 }}>Everything here comes from your own resume and saved answers. Gender, date of birth and similar questions are yours to answer on the company’s page.</p>
    </div>
  );
}

export function KitCard({ it, toast, onChanged, helper }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const act = async (what, msg) => {
    setBusy(what);
    try { await http(`${BASE}/onetap/${it.id}/${what}`, { method: 'POST' }); toast(msg); onChanged(); } catch (x) { toast(x.message); setBusy(''); }
  };
  const applyNow = () => {
    // open the company's page first (inside the tap, so the browser allows the new tab), then note it
    window.open(it.applyUrl, '_blank', 'noopener,noreferrer');
    setOpen(true);
    http(`${BASE}/onetap/${it.id}/opened`, { method: 'POST' }).catch(() => {});
  };
  return (
    <li className={`mcard mcard-tight stack g8 aa2-row ${it.closed ? 'aa2-closed' : ''}`} data-testid="aa2-kitcard" data-closed={it.closed ? '1' : '0'}>
      <div className="aa2-rowtop">
        <div className="aa2-job">
          <span className="mavatar" aria-hidden="true">{(it.job.company || '?').slice(0, 1).toUpperCase()}</span>
          <span className="stack g4" style={{ minWidth: 0 }}>
            <strong className="aa2-title">{it.job.title}</strong>
            <span className="xs muted aa2-wrap">{it.job.company}{it.score != null ? ` · match ${it.score}` : ''}{it.applyHost ? ` · ${it.applyHost}` : ''}</span>
          </span>
        </div>
        <span className="aa2-tags">
          {it.closed ? <Chip tone="neutral">Closed</Chip> : <Chip tone="accent">Ready</Chip>}
          {it.listedToday && !it.closed && <span className="xs muted">This morning</span>}
        </span>
      </div>
      {it.closed && <span className="small aa2-wrap" data-testid="aa2-kit-closed">{it.closedText} You can’t apply to it any more.</span>}
      {!it.closed && it.readyText && <span className="xs muted aa2-wrap">{it.readyText}</span>}
      {!it.closed && it.reminded && <span className="xs aa2-wrap" data-testid="aa2-kit-reminded">Did you apply? Tap “I applied” so your tracker is right.</span>}
      {helper && !it.closed && !it.byEmail && it.applyUrl && (
        <span className="xs aa2-wrap" data-testid="aa2-helper-promo">{helper.text}: <a href={helper.storeUrl} target="_blank" rel="noopener noreferrer">get it on the Chrome Web Store</a></span>
      )}
      <div className="row g8 aa2-actions">
        {!it.closed && it.applyUrl && <button type="button" className="btn btn-signal btn-sm" disabled={!!busy} onClick={applyNow} data-testid="aa2-apply-now">{it.byEmail ? 'Write the email' : 'Apply now'}</button>}
        {!it.closed && <button type="button" className="btn btn-outline btn-sm" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="aa2-kit-open">{open ? 'Hide kit' : 'Open kit'}</button>}
        <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => act('applied', 'Moved to Applied')} data-testid="aa2-i-applied">{it.closed ? 'I applied before it closed' : 'I applied'}</button>
        <button type="button" className="link-btn small" disabled={!!busy} onClick={() => act('dismiss', it.closed ? 'Removed' : 'Hidden. It won’t come back.')} data-testid="aa2-not-applying">{it.closed ? 'Remove' : 'Not applying'}</button>
      </div>
      {open && !it.closed && (
        <>
          {it.openedAt ? <span className="xs muted">The company’s page is open in another tab. Keep this kit beside it, copy and paste, then press Submit there yourself.</span> : null}
          <Kit id={it.id} toast={toast} />
        </>
      )}
    </li>
  );
}

function HelperPanel({ toast }) {
  const [d, setD] = useState(null);
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState('');
  const load = useCallback(() => http(`${BASE}/helper`).then(setD, () => setD(false)), []);
  useEffect(() => { load(); }, [load]);
  if (d === false) return null;
  const make = async () => {
    setBusy(true);
    try { setCode(await http(`${BASE}/helper/code`, { method: 'POST' })); } catch (x) { toast(x.message); } finally { setBusy(false); }
  };
  const signOut = async (id) => {
    setBusy(true);
    try { await http(`${BASE}/helper/${id}`, { method: 'DELETE' }); toast('Signed out'); setAsk(''); load(); } catch (x) { toast(x.message); } finally { setBusy(false); }
  };
  return (
    <section className="mcard stack g12" aria-labelledby="aa2-helper-h" data-testid="aa2-helper">
      <h2 id="aa2-helper-h" className="mcard-title">Nm7 Apply helper</h2>
      <p className="small muted" style={{ margin: 0 }}>A Chrome extension that fills the company’s apply form from your kit and attaches your resume where the page allows it. You check everything and press Submit yourself. It never presses Submit, never signs in to other sites, never creates accounts, never touches “I’m not a robot” checks and does nothing on job boards.</p>
      <p className="xs muted" style={{ margin: 0 }}>Works in Chrome on a laptop. On Android it needs a Chrome-based browser that allows extensions (such as Kiwi or Edge Canary); the normal Chrome app on phones doesn’t allow extensions. Coming to the Chrome Web Store soon.</p>
      {code ? (
        <div className="aa2-note stack g4" data-testid="aa2-helper-code">
          <span className="xs muted">Paste this code in the helper. It works once, for {code.minutes} minutes.</span>
          <div className="aa2-bar"><strong className="aa2-code">{code.code}</strong><CopyButton value={code.code} label="pairing code" toast={toast} /></div>
        </div>
      ) : (
        <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy || !d} onClick={make} data-testid="aa2-helper-make">Make a pairing code</button>
      )}
      {d && d.devices.length > 0 && (
        <ul className="stack g8 aa2-list" data-testid="aa2-helper-devices">
          {d.devices.map((x) => (
            <li key={x.id} className="aa2-kitrow">
              <span className="stack g4"><strong className="small">{x.device}</strong><span className="xs muted">Signed in {new Date(x.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · until {new Date(x.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></span>
              {ask === x.id ? (
                <span className="row g8"><button type="button" className="btn btn-signal btn-sm" disabled={busy} onClick={() => signOut(x.id)} data-testid="aa2-helper-signout-yes">Sign out</button><button type="button" className="link-btn small" onClick={() => setAsk('')}>Cancel</button></span>
              ) : <button type="button" className="link-btn small" onClick={() => setAsk(x.id)} data-testid="aa2-helper-signout">Sign out</button>}
            </li>
          ))}
        </ul>
      )}
      {d && <span className="xs muted">The helper can only read your jobs-ready kits and mark a job applied. A browser stays signed in for {d.tokenDays} days at most.</span>}
    </section>
  );
}

export default function OneTap({ toast, onChanged }) {
  const [d, setD] = useState(null);
  const load = useCallback(() => http(`${BASE}/onetap`).then(setD).catch(() => setD({ items: [], open: 0, morning: null })), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (d?.morning && !d.morning.seen) http(`${BASE}/onetap/seen`, { method: 'POST' }).catch(() => {});
  }, [d]);
  if (!d) return <Skel cards={2} />;
  const changed = () => { load(); onChanged?.(); };
  return (
    <div className="stack g12" data-testid="aa2-onetap">
      <div className="aa2-bar">
        <span className="small" data-testid="aa2-onetap-head">
          {d.morning ? <><strong>{d.open} job{d.open === 1 ? '' : 's'} ready</strong> this morning. </> : <><strong>{d.open} job{d.open === 1 ? '' : 's'} ready.</strong> </>}
          <span className="muted">Nm7 can’t send these for you, so each comes with a kit: your tailored resume, a cover note and ready answers. Tap Apply now, paste from the kit, press Submit on the company’s page, then tap I applied.</span>
        </span>
      </div>
      {d.items.length === 0 ? <Empty compact title="No jobs ready right now" testid="aa2-onetap-empty">When a job can only be applied to on the company’s own page, it comes here each morning with its kit.</Empty> : (
        <ul className="stack g8 aa2-list">{d.items.map((it) => <KitCard key={it.id} it={it} toast={toast} onChanged={changed} helper={d.helper} />)}</ul>
      )}
      <HelperPanel toast={toast} />
    </div>
  );
}
