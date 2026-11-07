// The project helper's rules, in the browser (the same as backend/app/projects/helper.py rules_bullets): bullets made
// only from the student's own answers, for the preview build and whenever the server can't be reached.
export const TIP = 'Add a number if you have one (users, accuracy, time saved).';
const t = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const tidy = (b) => { const s = t(b).replace(/^[•\-*–▸ ]+/, '').replace(/[ .]+$/, ''); return s.charAt(0).toUpperCase() + s.slice(1); };
const join = (xs) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const NUMBER = /\d+(?:[.,]\d+)?/;
// the same as helper.py: a "what does it do" answer that starts with one of these verbs → "Designed it to <verb> …"
const VERBS = new Set(['helps', 'lets', 'allows', 'shows', 'tracks', 'predicts', 'finds', 'sends', 'reads', 'makes', 'gives', 'displays',
  'stores', 'counts', 'lists', 'records', 'calculates', 'checks', 'reminds', 'notifies', 'books', 'manages',
  'collects', 'compares', 'converts', 'generates', 'sorts', 'matches', 'suggests', 'detects', 'scans', 'keeps',
  'saves', 'measures', 'plays', 'teaches', 'answers', 'connects', 'controls', 'monitors', 'creates', 'builds']);
const base = (v) => { const w = v.toLowerCase(); if (w.endsWith('ies')) return `${w.slice(0, -3)}y`; if (/(sses|shes|ches|xes)$/.test(w)) return w.slice(0, -2); return w.slice(0, -1); };
const leadLower = (x) => x.replace(/^(a|an|the|my|our|one)\b/i, (m) => m.toLowerCase());

export function localBullets(answers, title = '') {
  const a = Object.fromEntries(Object.entries(answers || {}).map(([k, v]) => [k, t(v).slice(0, 300)]));
  const built = a.built || t(title);
  const tools = (a.tools || '').split(/,|\/|\band\b|\+/).map(t).filter(Boolean);
  const out = [];
  if (built) out.push(`Built ${leadLower(built.replace(/^(i |we )?(built|made|created|developed)\s+/i, ''))}${tools.length ? ` using ${join(tools)}` : ''}`);
  else if (tools.length) out.push(`Worked with ${join(tools)}`);
  if (a.does) {
    const does = a.does.replace(/^(it |this |the app |the project |the dashboard |the website |my project )/i, '').trim();
    const [first, ...rest] = does.split(' ');
    out.push(VERBS.has(first.toLowerCase()) ? `Designed it to ${[base(first), ...rest].join(' ')}` : `Main feature: ${leadLower(does)}`);
  }
  const size = NUMBER.exec(a.team || '');
  if (a.part) {
    const p = leadLower(a.part.replace(/^(i |my part:?\s*)/i, ''));
    out.push(size && Number(size[0].replace(',', '')) > 1 ? `Handled ${p} in a team of ${size[0]}` : `Handled ${p}`);
  }
  if (a.result) out.push(`Result: ${a.result}`);
  const hasNumber = NUMBER.test(`${a.result || ''} ${a.does || ''}`);
  return { bullets: out.map(tidy).filter(Boolean).slice(0, 4), tip: hasNumber ? null : TIP, note: '' };
}
