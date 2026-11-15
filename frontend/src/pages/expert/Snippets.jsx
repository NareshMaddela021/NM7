// The expert's own library of bullets and summaries, by role. Inserted from the order workspace.
import { useState } from 'react';
import { ExpertPage } from './ExpertFrame';
import { Chip, Empty } from '../me/kit';
import { useToast } from '../../components/ui';
import { useSnippets, setSnippets } from '../../lib/expertStore';

export default function Snippets() {
  const toast = useToast();
  const list = useSnippets();
  const [f, setF] = useState('');
  const [n, setN] = useState({ role: '', kind: 'Bullet', text: '' });
  const roles = [...new Set(list.map((s) => s.role))];
  return (
    <ExpertPage width="wide" kicker="Your library" title="My snippets" sub="Your best bullets and summaries, ready to insert in any order. Use [brackets] for parts to fill in. Only you see them." shape="resume">
      <div className="ex-snip-grid">
        <form className="mcard ex-snip-form stack g12" onSubmit={(e) => { e.preventDefault(); setSnippets([{ id: `s${Date.now()}`, ...n, role: n.role.trim(), text: n.text.trim() }, ...list]); setN({ ...n, text: '' }); toast('Snippet saved'); }}>
          <header className="mcard-h"><span className="mcard-ic violet" aria-hidden="true">+</span><span className="mcard-ht"><strong className="mcard-title">New snippet</strong><span className="mcard-sub">At least 15 characters.</span></span></header>
          <div className="field"><label htmlFor="snr" className="label">Role</label><input id="snr" className="input" list="sn-roles" value={n.role} onChange={(e) => setN({ ...n, role: e.target.value })} placeholder="Data Analyst" /><datalist id="sn-roles">{roles.map((r) => <option key={r} value={r} />)}</datalist></div>
          <div className="field"><label htmlFor="snk" className="label">Type</label><select id="snk" className="input" value={n.kind} onChange={(e) => setN({ ...n, kind: e.target.value })}><option>Bullet</option><option>Summary</option></select></div>
          <div className="field"><label htmlFor="snt" className="label">Text</label><textarea id="snt" className="input" rows={4} value={n.text} onChange={(e) => setN({ ...n, text: e.target.value })} placeholder="Reduced [process] time by [X]% by automating [task] in [tool]" /></div>
          <button type="submit" className="btn btn-signal" disabled={!n.role.trim() || n.text.trim().length < 15}>Save snippet</button>
        </form>
        <div className="mstack">
          <div className="ex-filter">{['', ...roles].map((r) => <button key={r || 'all'} type="button" className="chip" aria-pressed={f === r} onClick={() => setF(r)}>{r || 'All'} <span className="mono xs" style={{ opacity: 0.7 }}>{list.filter((s) => !r || s.role === r).length}</span></button>)}</div>
          {list.length === 0 && <Empty shape="resume" title="No snippets yet">Save your best bullet on the left to reuse it in any order.</Empty>}
          {list.filter((s) => !f || s.role === f).map((s) => (
            <div key={s.id} className="ex-snip">
              <span className="row g8"><Chip tone="accent">{s.role}</Chip><Chip tone="neutral">{s.kind}</Chip></span>
              <span className="ex-snip-text">{s.text}</span>
              <span className="row g8">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => { navigator.clipboard?.writeText(s.text).then(() => toast('Copied'), () => toast('Copy not allowed here')); }}>Copy</button>
                <button type="button" className="btn btn-danger-soft btn-sm" onClick={() => { setSnippets(list.filter((x) => x.id !== s.id)); toast('Deleted'); }}>Delete</button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </ExpertPage>
  );
}
