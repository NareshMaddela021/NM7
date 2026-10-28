// "Check before download": the exact print preview (the very PDF that will be saved, drawn page by page, always on
// white paper whatever the site theme) and a checklist next to it. "Download anyway" is always there.
import { useEffect, useRef, useState } from 'react';
import { Dialog, Spinner } from './ui';
import { onCheck } from '../lib/downloads';
import { printChecks, problems, readPrint } from '../lib/printCheck';
import { closePdf, loadPdfjs } from '../lib/import';
import { http, LIVE } from '../services/http';
import { useAuth } from '../lib/auth';

export default function PrintCheckHost() {
  const [c, setC] = useState(null);
  useEffect(() => onCheck(setC), []);
  return c ? <PrintCheck c={c} /> : null;
}

/** The college format of a group the student shares this resume with (its rules), if any. */
function useCollege(enabled) {
  const [f, setF] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let on = true;
    http('/api/me/groups').then((gs) => { if (on) setF((gs || []).map((g) => g.format).find((x) => x?.rules) || null); }, () => {});
    return () => { on = false; };
  }, [enabled]);
  return f;
}

function PrintCheck({ c }) {
  const { user } = useAuth();
  const college = useCollege(LIVE && user?.role === 'customer' && !c.cover);
  const [print, setPrint] = useState(null);
  const [err, setErr] = useState('');
  const pagesRef = useRef(null);
  useEffect(() => {
    let doc = null;
    let on = true;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        doc = await pdfjs.getDocument({ data: new Uint8Array(await c.pdf.arrayBuffer()) }).promise;
        const p = await readPrint(doc);
        if (!on) return;
        setPrint(p);
        const box = pagesRef.current;
        for (let i = 1; i <= doc.numPages && on; i++) {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = vp.width; canvas.height = vp.height;
          canvas.setAttribute('data-testid', 'print-page');
          canvas.setAttribute('aria-label', `Page ${i} of ${doc.numPages}`);
          canvas.setAttribute('role', 'img');
          Object.assign(canvas.style, { width: '100%', height: 'auto', display: 'block', background: '#fff', boxShadow: '0 1px 6px rgba(0,0,0,0.25)', marginBottom: '12px' });
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: vp, background: '#ffffff' }).promise;
          box?.appendChild(canvas);
        }
      } catch {
        if (on) setErr('The preview couldn’t be drawn here, but your file is ready.');
      } finally { closePdf(doc); }
    })();
    return () => { on = false; };
  }, [c.pdf]);
  const items = print || err ? printChecks({ data: c.data, design: c.design, print, college, photo: c.photo, cover: !!c.cover }) : [];
  const n = problems(items);
  const what = c.format === 'docx' ? 'Word' : 'PDF';
  return (
    <Dialog title="Check before you download" onClose={() => c.done(false)} wide top>
      <div className="row between g8" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 20 }}>Check before you download</strong>
        <span className="small muted">{print ? `${print.count} page${print.count > 1 ? 's' : ''} · exactly as it prints` : 'Preparing the preview…'}</span>
      </div>
      <div className="print-check" data-testid="print-check" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', alignItems: 'start' }}>
        {/* the paper: always light, whatever the site's theme */}
        <div style={{ colorScheme: 'light', background: '#e9e9ee', borderRadius: 10, padding: 12, maxHeight: '60vh', overflow: 'auto' }} data-testid="print-paper">
          {!print && !err && <div className="row g8" style={{ color: '#333' }} role="status"><Spinner /> Drawing the pages…</div>}
          {err && <p className="small" style={{ color: '#333', margin: 0 }}>{err}</p>}
          <div ref={pagesRef} />
        </div>
        <div className="stack g8">
          <strong className="small">{items.length ? (n ? `${n} thing${n > 1 ? 's' : ''} to look at` : 'All checks passed') : 'Checking…'}</strong>
          <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Checks">
            {items.map((i) => (
              <li key={i.key} className="row g8 small" style={{ alignItems: 'flex-start' }} data-testid={`check-${i.key}`} data-ok={i.ok ? 'yes' : 'no'}>
                <span aria-hidden="true" style={{ flex: 'none', width: 18, color: i.ok ? 'var(--success)' : 'var(--warning)', fontWeight: 700 }}>{i.ok ? '✓' : '!'}</span>
                <span><span className="sr-only">{i.ok ? 'OK: ' : 'Check: '}</span>{i.text}</span>
              </li>
            ))}
          </ul>
          {c.format === 'docx' && <span className="xs muted">The Word file has the same content; Word may lay it out slightly differently.</span>}
        </div>
      </div>
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ink" onClick={() => c.done(true)} data-testid="check-download">{n ? `Download ${what} anyway` : `Download ${what}`}</button>
        <button type="button" className="btn btn-outline" onClick={() => c.done(false)} data-testid="check-back">Back to editing</button>
      </div>
    </Dialog>
  );
}
