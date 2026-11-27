// The Nm7 Apply helper's release gates, on every multi-step practice form (src/pages/demo/practiceSystems.js, one
// per kind of hiring system), filled step by step with the review account's kit:
//   - 90% or more of the fields the kit can answer are filled (sensitive questions, declarations and questions for
//     a smart answer are left for the candidate by design and counted apart);
//   - wrong values under 1 in 100 (each value compared with what the kit says);
//   - from page open to ready to submit in under 60 seconds.
// The build fails when any form drops under 90%. The table is printed in the test output. The same gates run in the
// browser against the live practice pages in e2e-live/apply-helper.spec.mjs.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it } from 'vitest';
import { SystemForm } from '../src/pages/demo/PracticeSystem.jsx';
import { SYSTEMS } from '../src/pages/demo/practiceSystems.js';
import { CITIES, COLLEGES, KIT, PDF, makePage } from './lib/helper-harness.mjs';

const kitField = (k) => (KIT.fields.find((x) => x.key === k) || {}).value;
const W = KIT.experience[0];
const E = KIT.education[0];
const ym = (s) => { const [y, m] = s.split('-'); return { y, m }; };

// what the kit says each field should get, in the form's own format
function expected(spec) {
  const k = spec.k;
  const ph = String(spec.a.placeholder || '').toUpperCase();
  const date = (raw) => {
    const { y, m } = ym(raw);
    if (spec.t === 'date') return `${y}-${m}-01`;
    if (spec.t === 'month') return `${y}-${m}`;
    if (ph === 'MM/YYYY') return `${m}/${y}`;
    if (ph === 'DD/MM/YYYY') return `01/${m}/${y}`;
    if (ph === 'YYYY') return y;
    return null;
  };
  const exact = {
    notice: spec.t === 'radio' || spec.t === 'select' ? '30 days' : kitField('notice'),
    degree: spec.t === 'select' ? 'Bachelor of Commerce (B.Com)' : kitField('degree'),
    'edu.degree': spec.t === 'select' ? 'Bachelor of Commerce (B.Com)' : E.degree,
    'work.company': W.company, 'work.title': W.title, 'work.description': W.description,
    'work.from_month': ym(W.from).m, 'work.from_year': ym(W.from).y, 'work.to_month': ym(W.to).m, 'work.to_year': ym(W.to).y,
    'work.from': date(W.from), 'work.to': date(W.to),
    'edu.school': E.school, 'edu.field': E.field, 'edu.from_year': ym(E.from).y, 'edu.to_year': ym(E.to).y, 'edu.to': date(E.to),
    answer: KIT.answers[0].answer, cover: KIT.coverNote, resume: true,
  };
  if (k in exact) return exact[k];
  return kitField(k);
}

const rows = [];

describe('release gates on the practice forms', () => {
  afterAll(() => {
    const line = (c) => c.map((x, i) => String(x).padEnd([16, 8, 8, 8, 8, 8, 10][i])).join(' ');
    // printed on purpose: the per-form table the release checklist asks for
    console.log(['', 'Apply helper release gates (practice forms, review kit)', line(['form', 'fields', 'filled', 'rate', 'wrong', 'drafts', 'time']),
      ...rows.map((r) => line([r.slug, r.total, r.filled, `${r.rate}%`, r.wrong, r.ask, `${r.ms} ms`]))].join('\n'));
  });

  for (const slug of Object.keys(SYSTEMS)) {
    it(`${slug}: 90%+ filled, under 1 in 100 wrong, under 60 s`, async () => {
      const sys = SYSTEMS[slug];
      const t0 = Date.now();
      let total = 0; let filled = 0; let wrong = 0; let ask = 0; let left = 0;
      const wrongs = [];
      for (let step = 0; step < sys.steps.length; step += 1) {
        const html = renderToStaticMarkup(createElement(SystemForm, { slug, start: step }));
        const p = makePage(html, { url: `https://nm7.si/demo/apply/${slug}`, fallback: [...CITIES, ...COLLEGES] });
        const r = await p.box.Nm7Fill(KIT, PDF);
        expect(r.blocked).toBeUndefined();
        expect(r.login).toBeUndefined();
        const s = sys.steps[step];
        const legendOf = (head) => [...p.doc.querySelectorAll('legend')].find((l) => l.textContent.trim() === `${head} 1`).parentElement;
        const specs = [...(s.fields || []).map((x) => [x, p.doc]), ...(s.blocks || []).flatMap((b) => b.fields.map((x) => [x, legendOf(b.head)])), ...(s.after || []).map((x) => [x, p.doc])];
        // the controls on the page in the same order as the specs
        for (const [spec, root] of specs) {
          const attrs = Object.fromEntries(Object.entries(spec.a).filter(([k]) => !['wrap', 'group', 'list'].includes(k)).map(([k, v]) => [k, typeof v === 'function' ? v(0) : v]));
          const label = spec.a.group ? `${spec.a.group} ${spec.l}` : spec.l;
          let el;
          if (spec.t === 'radio') el = p.doc.querySelector(`input[name="${attrs.name}"]`);
          else if (attrs.id) el = p.doc.getElementById(attrs.id);
          else {
            const labs = [...root.querySelectorAll('label')].filter((l) => l.textContent.trim() === label);
            const candidates = labs.map((l) => (l.htmlFor ? p.doc.getElementById(l.htmlFor) : l.querySelector('input'))).filter(Boolean);
            el = candidates.find((c) => Object.entries(attrs).every(([k, v]) => c.getAttribute(k) === String(v))) || candidates[0];
          }
          expect(el, `${slug} ${label}`).toBeTruthy();
          const mark = (el.closest('[data-nm7-mark]') || { getAttribute: () => null }).getAttribute('data-nm7-mark');
          if (spec.k === 'personal' || spec.k === 'consent') {
            expect(mark, `${slug} ${label} is left for the candidate`).toBe('left');
            expect(spec.t === 'checkbox' ? el.checked : el.value, `${slug} ${label} untouched`).toBeFalsy();
            left += 1;
            continue;
          }
          if (spec.k === 'ask') { expect(mark).toBe('left'); ask += 1; continue; }
          if (!spec.k) continue;
          total += 1;
          const want = expected(spec);
          let got;
          if (spec.t === 'file') got = el.files && el.files.length === 1 ? true : null;
          else if (spec.t === 'radio') got = (p.doc.querySelector(`input[name="${attrs.name}"]:checked`) || {}).value || '';
          else got = el.value;
          if (got && got !== '') {
            filled += 1;
            if (got !== want) { wrong += 1; wrongs.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
          }
        }
        p.close();
      }
      const ms = Date.now() - t0;
      const rate = Math.round((1000 * filled) / total) / 10;
      rows.push({ slug, total, filled, rate, wrong, ask, ms });
      expect(wrongs, `${slug} wrong values`).toEqual([]);
      expect(rate, `${slug} fill rate`).toBeGreaterThanOrEqual(90);
      expect(wrong / Math.max(1, filled)).toBeLessThan(0.01);
      expect(ms).toBeLessThan(60_000);
      expect(left + ask + total).toBeGreaterThan(0);
    }, 60_000);
  }
});
