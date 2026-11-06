// What Auto Apply did and what waits for the student (Phase 3, A3 and the preview days): "Needs your answer" (the
// job's questions, one tap each, "remember for next time"; or a borderline match: Apply anyway / Skip), "Waiting for
// your Approve" (preview days: Approve, Approve all, Skip), answered after today's limit (sent first thing tomorrow),
// and what was applied. Answering applies at once. English, Telugu and Hindi (aa.items.*). No pop-up dialogs.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE, http } from '../../services/http';

const BASE = '/api/me/auto-apply/items';

function JobLine({ it, t }) {
  return (
    <span className="stack g4" style={{ minWidth: 0 }}>
      <Link to={`/jobs/${it.job.slug}`} style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{it.job.title}</Link>
      <span className="xs muted">{it.job.company}{it.score != null ? ` · ${t('jobs.match.pct', { n: it.score })}` : ''}</span>
    </span>
  );
}

function Questions({ it, t, onDone }) {
  const [answers, setAnswers] = useState({});
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (id, v) => setAnswers((a) => ({ ...a, [id]: v }));
  const send = async (e) => {
    e.preventDefault();
    if (it.questions.some((q) => answers[q.id] == null || String(answers[q.id]).trim() === '')) { setErr(t('jobs.apply.qMissing')); return; }
    setBusy(true); setErr('');
    try {
      const body = { remember, answers: Object.fromEntries(it.questions.map((q) => [q.id, q.kind === 'number' ? Number(answers[q.id]) : answers[q.id]])) };
      onDone(await http(`${BASE}/${it.id}/answer`, { method: 'POST', body }));
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <form className="stack g8" onSubmit={send}>
      {it.questions.map((q) => (
        <fieldset key={q.id} className="stack g4" style={{ border: 0, margin: 0, padding: 0 }}>
          {q.kind === 'number' ? (
            <div className="field"><label className="label" htmlFor={`ai-${it.id}-${q.id}`}>{q.text}</label>
              <input id={`ai-${it.id}-${q.id}`} className="input" inputMode="numeric" maxLength={6} value={answers[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value.replace(/[^\d]/g, ''))} /></div>
          ) : (
            <>
              <legend className="label">{q.text}</legend>
              <div className="row g12" style={{ flexWrap: 'wrap' }}>
                {(q.kind === 'yesno' ? [['yes', t('jobs.apply.yes')], ['no', t('jobs.apply.no')]] : q.options.map((o) => [o, o])).map(([v, l]) => (
                  <label key={v} className="row g4 small"><input type="radio" name={`ai-${it.id}-${q.id}`} checked={answers[q.id] === v} onChange={() => set(q.id, v)} /> {l}</label>
                ))}
              </div>
            </>
          )}
        </fieldset>
      ))}
      <label className="row g8 small"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t('aa.items.remember')}</label>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy}>{busy ? t('jobs.loading') : t('aa.items.answerApply')}</button>
    </form>
  );
}

/** The tailored resume for one job, as a PDF file (made on the server from the copy Nm7 prepared). */
async function downloadPdf(id) {
  const r = await fetch(`${API_BASE}${BASE}/${id}/resume.pdf`, { credentials: 'include' });
  if (!r.ok) throw new Error('download');
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = (/filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '') || [])[1] || 'Resume.pdf';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AutoItems({ t, toast, refreshKey }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(() => { http(BASE).then(setD, (e) => setErr(e.message)); }, []);
  useEffect(() => { load(); }, [load, refreshKey]);
  const said = (r) => toast(r.state === 'applied' ? t('aa.items.applied') : r.state === 'queued' ? t('aa.items.queued') : r.state === 'waiting_approval' ? t('aa.items.waitingToast') : r.state === 'skipped' ? t('aa.items.skipped') : t('aa.items.saved'));
  const act = async (id, path) => {
    setBusy(id); setErr('');
    try { said(await http(`${BASE}/${id}/${path}`, { method: 'POST' })); load(); } catch (x) { setErr(x.message); } finally { setBusy(''); }
  };
  const approveAll = async () => {
    setBusy('all'); setErr('');
    try { const r = await http(`${BASE}/approve-all`, { method: 'POST' }); toast(t('aa.items.approvedAll', { n: r.applied })); load(); } catch (x) { setErr(x.message); } finally { setBusy(''); }
  };
  if (!d) return err ? <p className="error" role="alert">{err}</p> : null;
  return (
    <>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <section id="needs" className="card stack g12" aria-labelledby="aa-need-h" data-testid="aa-needs" style={{ scrollMarginTop: 96 }}>
        <div className="row g8" style={{ justifyContent: 'space-between' }}><strong id="aa-need-h">{t('aa.items.needs')}</strong><span className="badge b-warning">{d.needsAnswer.length}</span></div>
        {d.needsAnswer.length === 0 && <span className="small muted">{t('aa.items.needsNone')}</span>}
        {d.needsAnswer.map((it) => (
          <article key={it.id} className="card-sm stack g8" data-testid="aa-need">
            <JobLine it={it} t={t} />
            {it.kind === 'borderline' ? (
              <>
                <span className="small">{t('aa.items.borderline')}</span>
                <div className="row g8"><button type="button" className="btn btn-ink" disabled={!!busy} onClick={() => act(it.id, 'go')}>{t('aa.items.go')}</button>
                  <button type="button" className="btn btn-outline" disabled={!!busy} onClick={() => act(it.id, 'skip')}>{t('aa.items.skip')}</button></div>
              </>
            ) : (
              <>
                <span className="small">{t('aa.items.questions')}</span>
                <Questions it={it} t={t} onDone={(r) => { said(r); load(); }} />
                <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} disabled={!!busy} onClick={() => act(it.id, 'skip')}>{t('aa.items.skip')}</button>
              </>
            )}
          </article>
        ))}
      </section>
      {d.waiting.length > 0 && (
        <section className="card stack g12" aria-labelledby="aa-wait-h" data-testid="aa-waiting">
          <div className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <strong id="aa-wait-h">{t('aa.items.waiting')}</strong>
            <button type="button" className="btn btn-ink" disabled={!!busy} onClick={approveAll} data-testid="aa-approve-all">{t('aa.items.approveAll', { n: d.waiting.length })}</button>
          </div>
          <span className="small muted">{t('aa.items.waitingHint')}</span>
          {d.waiting.map((it) => (
            <article key={it.id} className="card-sm row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }} data-testid="aa-wait">
              <JobLine it={it} t={t} />
              <span className="row g8"><button type="button" className="btn btn-ink" disabled={!!busy} onClick={() => act(it.id, 'approve')}>{t('aa.items.approve')}</button>
                <button type="button" className="btn btn-outline" disabled={!!busy} onClick={() => act(it.id, 'skip')}>{t('aa.items.skip')}</button></span>
            </article>
          ))}
        </section>
      )}
      <section id="ready" className="card stack g12" aria-labelledby="aa-ready-h" data-testid="aa-ready" style={{ scrollMarginTop: 96 }}>
        <div className="row g8" style={{ justifyContent: 'space-between' }}><strong id="aa-ready-h">{t('aa.items.ready')}</strong><span className="badge b-neutral">{d.ready.length}</span></div>
        <span className="small muted">{t('aa.items.readyHint')}</span>
        {d.ready.map((it) => (
          <article key={it.id} className="card-sm stack g8" data-testid="aa-ready-item">
            <JobLine it={it} t={t} />
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              {it.applyUrl && <a className="btn btn-ink" href={it.applyUrl} target="_blank" rel="noopener noreferrer nofollow" data-testid="aa-open"
                onClick={() => { http(`${BASE}/${it.id}/opened`, { method: 'POST' }).then(() => { toast(t('aa.items.openedToast')); load(); }, () => {}); }}>{t('aa.items.open')} <span aria-hidden="true">↗</span></a>}
              {it.hasCopy && <button type="button" className="btn btn-outline" disabled={!!busy} onClick={() => downloadPdf(it.id).catch(() => setErr(t('aa.items.pdfError')))} data-testid="aa-pdf">{t('aa.items.pdf')}</button>}
              <button type="button" className="link-btn small" disabled={!!busy} onClick={() => act(it.id, 'skip')}>{t('aa.items.skip')}</button>
            </div>
          </article>
        ))}
        {d.ready.length === 0 && <span className="small muted">{t('aa.items.readyNone')}</span>}
      </section>
      {d.queued.length > 0 && (
        <section className="card-sm stack g8" aria-labelledby="aa-q-h" data-testid="aa-queued">
          <strong id="aa-q-h" className="small">{t('aa.items.queuedTitle')}</strong>
          {d.queued.map((it) => <JobLine key={it.id} it={it} t={t} />)}
        </section>
      )}
      <section className="card stack g8" aria-labelledby="aa-done-h" data-testid="aa-applied">
        <strong id="aa-done-h">{t('aa.items.appliedTitle')}</strong>
        {d.applied.length === 0 && <span className="small muted">{t('aa.items.appliedNone')}</span>}
        {d.applied.map((it) => (
          <div key={it.id} className="stack g4">
            <JobLine it={it} t={t} />
            {it.sent && <span className="xs muted" data-testid="aa-sent">{t('aa.items.sentTo', { to: it.sent.to })}{it.delivery === 'bounced' ? ` · ${t('aa.items.bounced')}` : ''}</span>}
          </div>
        ))}
        {d.applied.length > 0 && <Link to="/me/jobs" className="small">{t('aa.seeApplications')}</Link>}
      </section>
    </>
  );
}
