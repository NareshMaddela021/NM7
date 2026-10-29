// The project helper's rules, in the browser (the same as backend/app/projects/helper.py rules_bullets): bullets made
// only from the student's own answers, for the preview build and whenever the server can't be reached.
export const TIP = 'Add a number if you have one (users, accuracy, time saved).';
const t = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const tidy = (b) => { const s = t(b).replace(/^[•\-*–▸ ]+/, '').replace(/[ .]+$/, ''); return s.charAt(0).toUpperCase() + s.slice(1); };
const join = (xs) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const NUMBER = /\d+(?:[.,]\d+)?/;

export function localBullets(answers, title = '') {
  const a = Object.fromEntries(Object.entries(answers || {}).map(([k, v]) => [k, t(v).slice(0, 300)]));
  const built = a.built || t(title);
  const tools = (a.tools || '').split(/,|\/|\band\b|\+/).map(t).filter(Boolean);
  const out = [];
  if (built) out.push(`Built ${built.replace(/^(i |we )?(built|made|created|developed)\s+/i, '')}${tools.length ? ` using ${join(tools)}` : ''}`);
  else if (tools.length) out.push(`Worked with ${join(tools)}`);
  if (a.does) {
    const does = a.does.replace(/^(it |this |the app |the project )/i, '');
    out.push(/^(helps|lets|allows|shows|tracks|predicts|finds|sends|reads|makes)\b/i.test(does) ? `Project ${does}` : `Made it ${does}`);
  }
  const size = NUMBER.exec(a.team || '');
  if (a.part) {
    const p = a.part.replace(/^(i |my part:?\s*)/i, '');
    out.push(size && Number(size[0].replace(',', '')) > 1 ? `Handled ${p} in a team of ${size[0]}` : `Handled ${p}`);
  }
  if (a.result) out.push(`Result: ${a.result}`);
  const hasNumber = NUMBER.test(`${a.result || ''} ${a.does || ''}`);
  return { bullets: out.map(tidy).filter(Boolean).slice(0, 4), tip: hasNumber ? null : TIP, note: '' };
}
