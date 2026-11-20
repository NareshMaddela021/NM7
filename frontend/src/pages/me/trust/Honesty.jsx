// Vetting Trust T9, loaded only by the skill check / interview pages (lazy) and only shown to people Vetting Trust is on
// for (trustOn):
//   Pledge       the honesty pledge before a skill check, a practical task or the AI interview: a short plain promise in
//                the test's language (English / Hindi / Telugu) and one tick box; ticking it gives the page the version
//                to send with the start (the server refuses to start without it and records version + time).
//   RetakeInfo   the retake limits from the server's own numbers: allowed per period, used, when the next attempt
//                opens (date + countdown) and what counts (the latest passed attempt).
//   ExplainNote  in the interview set-up: 1–2 questions may ask about their own practical task.
//   PledgeNote   on a result: "You took the honesty pledge (version 1) on …".
import { useEffect, useState } from 'react';
import { http } from '../../../services/http';
import { trustOn } from '../../../lib/trustAccess';
import { dayText, pledgeText, retakeLines } from './honestyLib';

let asked = null;
const pledge = () => {
  if (!asked) asked = trustOn().then((on) => (on ? http('/api/me/trust/honesty').then((d) => d.pledge, () => null) : null));
  return asked;
};

export function Pledge({ kind, lang = 'en', onChange }) {
  const [p, setP] = useState(null);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let live = true;
    pledge().then((x) => { if (live && x) { setP(x); onChange?.(null); } });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return null;
  const t = pledgeText(p, lang);
  const what = kind === 'interview' ? 'interview' : kind === 'task' ? 'task' : 'test';
  return (
    <fieldset className="vet-fs" data-testid={`pledge-${kind}`}>
      <legend className="vet-legend">{t.title}</legend>
      <p className="small" style={{ margin: 0 }} lang={lang} data-testid="pledge-text">{t.text}</p>
      <label className="vet-check">
        <input type="checkbox" checked={ok} onChange={(e) => { setOk(e.target.checked); onChange?.(e.target.checked ? p.version : null); }} data-testid="pledge-tick" />
        <span><strong lang={lang}>{t.tick}</strong><span className="xs muted" style={{ display: 'block' }}>Needed to start the {what}. It is a promise in plain words, not a trap: nothing is decided by it.</span></span>
      </label>
    </fieldset>
  );
}

export function RetakeInfo({ rk, what = 'test', testid = 'retake' }) {
  const l = retakeLines(rk, what);
  if (!l) return null;
  return (
    <div className="vet-calm stack g4" data-testid={testid} role="note">
      <strong className="small">Attempts and retakes</strong>
      <span className="xs" data-testid="retake-rule">{l.rule}</span>
      <span className="xs" data-testid="retake-used">{l.used}</span>
      <span className="xs" data-testid="retake-next"><strong>{l.next}</strong></span>
      {l.counts && <span className="xs muted" data-testid="retake-counts">What counts: {l.counts}</span>}
      {l.refresh && <span className="xs muted">{l.refresh}</span>}
    </div>
  );
}

export function ExplainNote() {
  return (
    <p className="xs muted" style={{ margin: 0 }} data-testid="explain-note">
      If you sent a written or spoken practical task for this role, 1 or 2 questions ask you to explain your own answer (why you chose it, what you would change). Answer in your own words; your language never lowers the result.
    </p>
  );
}

export function PledgeNote({ items }) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return null;
  return <span className="xs muted" data-testid="pledge-note">{list.map((x) => `You took the honesty pledge${x.what ? ` for the ${x.what}` : ''} (version ${x.version}) on ${dayText(x.at)}.`).join(' ')}</span>;
}
