// Side-by-side change list between two resume versions (removed lines red, added lines green).
import { buildSections } from './resumeModel';
import { DEFAULT_DESIGN, TEMPLATE_PRESETS } from './design';

/** Section → printed lines, for the compare view. */
export function sectionLines(data) {
  const ds = { ...DEFAULT_DESIGN, ...(data.design || TEMPLATE_PRESETS.fresher.design), layout: 'one' };
  const { main } = buildSections(data, ds);
  const out = [{ title: 'Header', lines: [data.personal?.name, data.personal?.headline].filter(Boolean) }];
  main.forEach((s) => out.push({ title: s.title, lines: s.items.flatMap((it) => [[it.head, it.date].filter(Boolean).join(' · '), it.sub, ...(it.lines || []).map((l) => (typeof l === 'string' ? l : l.t || (l.kv ? `${l.kv[0]}: ${l.kv[1]}` : l.bold ? `${l.bold} ${l.text}` : l.label ? `${l.label}: ${l.chips.join(', ')}` : '')))]).filter(Boolean) }));
  return out;
}
export default function Compare({ a, b, aLabel, bLabel }) {
  const A = sectionLines(a); const B = sectionLines(b);
  const titles = [...new Set([...B.map((s) => s.title), ...A.map((s) => s.title)])]; // newer version's order
  return (
    <div className="stack g12">
      <span className="xs muted"><span style={{ background: 'var(--dangerbg)', textDecoration: 'line-through', padding: '0 4px' }}>removed</span> in {aLabel} · <span style={{ background: 'var(--successbg)', padding: '0 4px' }}>added</span> in {bLabel}</span>
      {titles.map((t) => {
        const la = A.find((s) => s.title === t)?.lines || []; const lb = B.find((s) => s.title === t)?.lines || [];
        const same = la.join('\n') === lb.join('\n');
        return (
          <div key={t} className="stack g4">
            <strong className="xs" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{t}{same && <span className="faint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}> · no change</span>}</strong>
            {!same && <>
              {la.filter((l) => !lb.includes(l)).map((l, i) => <span key={`a${i}`} className="small" style={{ background: 'var(--dangerbg)', textDecoration: 'line-through', padding: '2px 6px', borderRadius: 4 }}>{l}</span>)}
              {lb.filter((l) => !la.includes(l)).map((l, i) => <span key={`b${i}`} className="small" style={{ background: 'var(--successbg)', padding: '2px 6px', borderRadius: 4 }}>{l}</span>)}
            </>}
          </div>
        );
      })}
    </div>
  );
}

