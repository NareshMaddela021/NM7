// The expert's own library of bullets and summaries, by role. Inserted from the order workspace.
import { useState } from 'react';
import Header from '../../components/Header';
import { useToast } from '../../components/ui';
import { useSnippets, setSnippets } from '../../lib/expertStore';

export default function Snippets() {
  const toast = useToast();
  const list = useSnippets();
  const [f, setF] = useState('');
  const [n, setN] = useState({ role: '', kind: 'Bullet', text: '' });
  const roles = [...new Set(list.map((s) => s.role))];
  return (
    <>
      <Header variant="expert" />
      <main className="container stack g16" style={{ maxWidth: 1000, padding: '24px 24px 64px' }}>
        <div className="stack g4"><h1 className="display" style={{ fontSize: 32 }}>My snippets</h1><span className="small muted">Your best bullets and summaries, ready to insert in any order. Use [brackets] for parts to fill in. Only you see them.</span></div>
        <form className="card stack g12" onSubmit={(e) => { e.preventDefault(); setSnippets([{ id: `s${Date.now()}`, ...n, role: n.role.trim(), text: n.text.trim() }, ...list]); setN({ ...n, text: '' }); toast('Snippet saved'); }}>
          <strong>New snippet</strong>
          <div className="row g8">
            <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="snr" className="label">Role</label><input id="snr" className="input" style={{ height: 42 }} list="sn-roles" value={n.role} onChange={(e) => setN({ ...n, role: e.target.value })} placeholder="Data Analyst" /><datalist id="sn-roles">{roles.map((r) => <option key={r} value={r} />)}</datalist></div>
            <div className="field" style={{ flex: '0 1 160px' }}><label htmlFor="snk" className="label">Type</label><select id="snk" className="input" style={{ height: 42 }} value={n.kind} onChange={(e) => setN({ ...n, kind: e.target.value })}><option>Bullet</option><option>Summary</option></select></div>
          </div>
          <div className="field"><label htmlFor="snt" className="label">Text</label><textarea id="snt" className="input" rows={3} value={n.text} onChange={(e) => setN({ ...n, text: e.target.value })} placeholder="Reduced [process] time by [X]% by automating [task] in [tool]" /></div>
          <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={!n.role.trim() || n.text.trim().length < 15}>Save snippet</button>
        </form>
        <div className="row g8">{['', ...roles].map((r) => <button key={r || 'all'} type="button" className="chip" aria-pressed={f === r} style={{ minHeight: 34, fontSize: 13 }} onClick={() => setF(r)}>{r || 'All'} <span className="mono xs" style={{ opacity: 0.7 }}>{list.filter((s) => !r || s.role === r).length}</span></button>)}</div>
        <div className="stack g8">
          {list.filter((s) => !f || s.role === f).map((s) => (
            <div key={s.id} className="card row between g12">
              <span className="stack g4" style={{ flex: '1 1 300px' }}><span className="xs muted">{s.role} · {s.kind}</span><span className="small">{s.text}</span></span>
              <span className="row g8">
                <button type="button" className="btn btn-outline" style={{ minHeight: 36 }} onClick={() => { navigator.clipboard?.writeText(s.text).then(() => toast('Copied'), () => toast('Copy not allowed here')); }}>Copy</button>
                <button type="button" className="btn btn-danger-soft" onClick={() => { setSnippets(list.filter((x) => x.id !== s.id)); toast('Deleted'); }}>Delete</button>
              </span>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
