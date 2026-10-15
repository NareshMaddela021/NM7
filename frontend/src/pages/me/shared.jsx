// Small pieces shared by the dashboard pages.
import { jsPDF } from 'jspdf';
import ResumePreview from '../builder/ResumePreview';
import { savePdf } from '../builder/resumePdf';
import { DownloadBlocked, exportFile } from '../../lib/downloads';
import { DEFAULT_DESIGN, TEMPLATE_PRESETS } from '../builder/design';
import { INVOICE, gstSplit } from '../../lib/pricing';

export const designOf = (d) => ({ ...DEFAULT_DESIGN, ...(d.design || TEMPLATE_PRESETS.fresher.design), preset: d.design?.preset ?? 'fresher' });
export const templateName = (d) => TEMPLATE_PRESETS[d.design?.preset || 'fresher']?.name || 'Custom';
export const fmtDay = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtShort = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const fmtWhen = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const ago = (t) => { const m = (Date.now() - t) / 60000; return m < 60 ? `${Math.max(1, Math.round(m))} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

/** A small, non-interactive picture of the resume's first page. */
export function ResumeThumb({ data, width = 150, label }) {
  return (
    <div className="thumb" style={{ width, height: Math.round(width * 1.414), flex: 'none' }} role="img" aria-label={label || `Preview of ${data.personal?.name ? `${data.personal.name}’s` : 'your'} resume`}>
      <div style={{ width, pointerEvents: 'none' }} aria-hidden="true"><ResumePreview data={data} design={designOf(data)} decorative /></div>
    </div>
  );
}

/** PDF / Word download (only once the server allows it — see lib/downloads). True when a file was saved. */
export async function downloadResume(data, format = 'pdf', cover, share) {
  try {
    await exportFile({ data, design: designOf(data), format, cover, share });
    return true;
  } catch (e) {
    if (e instanceof DownloadBlocked) return false;
    throw e;
  }
}

/** Time left to a deadline, in whole minutes (never "60m"). */
export function countdown(deadline) {
  const mins = Math.floor((deadline - Date.now()) / 60000);
  if (mins < 0) return { late: true, text: `${Math.ceil(-mins / 60)}h past the deadline` };
  return { late: false, text: mins < 60 ? `${mins} min left` : `${Math.floor(mins / 60)}h ${mins % 60}m left`, hours: mins / 60 };
}

/** A GST invoice as a PDF (Helvetica — "Rs." because the built-in PDF font has no ₹ sign). */
export async function invoicePdf({ no, at, name, email, item, amount, payId, method }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const rs = (n) => `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const { taxable, gst } = gstSplit(amount);
  const L = 56; let y = 70;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text('Tax invoice', L, y);
  doc.setFontSize(11); doc.text(`${INVOICE.company} · ${INVOICE.brand}`, 540, y, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  if (INVOICE.gstin) { y += 18; doc.text(`GSTIN: ${INVOICE.gstin}`, 540, y, { align: 'right' }); }
  y += 30;
  [['Invoice no.', no], ['Date', fmtDay(at)], ['Billed to', `${name} · ${email}`], ['Payment', `${method} · ${payId} (Razorpay)`]].forEach(([k, v]) => { doc.setTextColor(110); doc.text(k, L, y); doc.setTextColor(20); doc.text(String(v), L + 90, y); y += 18; });
  y += 18; doc.setDrawColor(200); doc.line(L, y, 540, y); y += 20;
  doc.setFont('helvetica', 'bold'); doc.text('Description', L, y); if (INVOICE.sacCode) doc.text(`SAC ${INVOICE.sacCode}`, 360, y); doc.text('Amount', 540, y, { align: 'right' }); doc.setFont('helvetica', 'normal');
  y += 22; doc.text(item, L, y, { maxWidth: 290 }); doc.text(rs(taxable), 540, y, { align: 'right' });
  y += 30; doc.line(L, y, 540, y); y += 20;
  [['Taxable value', rs(taxable)], [`GST @ ${INVOICE.gstPct}%`, rs(gst)]].forEach(([k, v]) => { doc.text(k, 360, y); doc.text(v, 540, y, { align: 'right' }); y += 18; });
  doc.setFont('helvetica', 'bold'); doc.text('Total paid', 360, y + 4); doc.text(rs(amount), 540, y + 4, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120);
  doc.text('Prices include GST. This is a computer-generated invoice and needs no signature.', L, 780);
  await savePdf(doc.output('blob'), `Invoice_${no.replace(/\//g, '-')}.pdf`);
}

/** Simple line chart for a score over time (one series, 0–100), with hover tooltip and a table view. */
export function ScoreTrend({ points, title = 'ATS score over time' }) {
  const W = 900; const Hh = 190; const pad = { l: 30, r: 12, t: 12, b: 24 };
  const x = (i) => pad.l + (points.length < 2 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v) => pad.t + (Hh - pad.t - pad.b) * (1 - v / 100);
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label={`${title}: ${points.map((p) => `${p.label} ${p.score}`).join(', ')}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <title>{title}</title>
      {[0, 50, 80, 100].map((v) => <g key={v}><line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--viz-grid)" strokeDasharray={v === 80 ? '4 4' : undefined} /><text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--text3)">{v}</text></g>)}
      <text x={W - pad.r} y={y(80) - 5} textAnchor="end" fontSize="10" fill="var(--text3)">Good (80+)</text>
      <polyline fill="none" stroke="var(--viz-1)" strokeWidth="2" strokeLinejoin="round" points={points.map((p, i) => `${x(i)},${y(p.score)}`).join(' ')} />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.score)} r="4" fill="var(--surface)" stroke="var(--viz-1)" strokeWidth="2"><title>{`${p.label}: ${p.score}`}</title></circle>
          {(i === points.length - 1) && <text x={x(i)} y={y(p.score) - 10} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)">{p.score}</text>}
          <text x={x(i)} y={Hh - 6} textAnchor="middle" fontSize="10" fill="var(--text3)">{p.short}</text>
        </g>
      ))}
    </svg>
  );
}
