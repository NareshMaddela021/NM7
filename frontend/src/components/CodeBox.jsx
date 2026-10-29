// "Have a code?" + Apply, on every pay screen. The server checks the code (POST /api/me/codes/apply, or the
// organization's own endpoint). A free code unlocks right here (no WhatsApp step); a discount shows the new price and
// the screen sends the code with its order. A code from a ?code= link is filled in, never used by itself.
import { useState } from 'react';
import { Spinner } from './ui';
import { http } from '../services/http';
import { forgetCode, normCode, priceText, savedCode } from '../lib/codes';

/**
 * item: resume | tailor_pack | interview_pack | launch | expert | linkedin_pack (customer); for an organization plan
 * pass `apply(code)` that returns the same shape ({ free, unlocked, text, final, original, code }).
 * onApplied(quote | null): a discount was applied (null when removed). onUnlocked(result): a free code unlocked it.
 */
export default function CodeBox({ item, resumeId, apply, onApplied, onUnlocked, disabled }) {
  const start = savedCode();
  const [open, setOpen] = useState(!!start);
  const [code, setCode] = useState(start);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const run = async (e) => {
    e.preventDefault();
    const c = normCode(code);
    if (!c) { setErr('Type your code.'); return; }
    setBusy(true); setErr('');
    try {
      const q = apply ? await apply(c) : await http('/api/me/codes/apply', { method: 'POST', body: { code: c, item, resumeId: resumeId || null } });
      setDone(q);
      forgetCode();
      if (q.unlocked) onUnlocked?.(q);
      else onApplied?.(q);
    } catch (x) {
      setErr(x.message || 'That code didn’t work. Please try again.');
    } finally { setBusy(false); }
  };
  const remove = () => { setDone(null); setCode(''); onApplied?.(null); };
  if (done) {
    return (
      <div className="well row between g8" role="status" data-testid="code-applied" style={{ flexWrap: 'wrap', alignItems: 'center', padding: '10px 12px' }}>
        <span className="small"><strong>{done.unlocked ? 'Code applied - unlocked' : done.text || priceText(done)}</strong></span>
        {!done.unlocked && <button type="button" className="link-btn xs" onClick={remove} disabled={disabled}>Remove code</button>}
      </div>
    );
  }
  if (!open) {
    return <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)} data-testid="code-open" disabled={disabled}>Have a code?</button>;
  }
  return (
    <form className="stack g4" onSubmit={run} data-testid="code-box" aria-label="Have a code?">
      <label className="small" htmlFor="pay-code">Have a code?</label>
      <div className="row g8">
        <input id="pay-code" className="input mono" style={{ height: 40, flex: '1 1 140px', minWidth: 0, textTransform: 'uppercase' }} maxLength={40} autoComplete="off" autoCapitalize="characters" spellCheck={false}
          value={code} onChange={(e) => { setCode(e.target.value); setErr(''); }} placeholder="CODE" data-testid="code-input" disabled={busy || disabled} />
        <button type="submit" className="btn btn-outline" disabled={busy || disabled} aria-busy={busy} data-testid="code-apply">{busy && <Spinner />}Apply</button>
      </div>
      {err && <span role="alert" className="error xs" data-testid="code-error">{err}</span>}
    </form>
  );
}
