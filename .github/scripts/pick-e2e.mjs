// CI_MODE=light: which live browser specs a pull request runs (the quick check, about 10 minutes). Prints the spec
// paths (relative to frontend/), one line, space separated.
//
// Always: a small smoke set (the site shell and sign-in, the home page, the easy dashboard). Then: every spec the pull
// request changed, and the specs whose names match the words in the changed files'
// paths (frontend/src/pages/company/CompanySignup.jsx → "company", "signup" → company-signup, company-demo …).
// At most MAX specs. The full suite (all specs, desktop + 390 px) runs nightly and by hand (e2e.yml, workflow_dispatch).
//
// Usage: node pick-e2e.mjs <changed file> …   (or the changed files on stdin, one per line)
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPECS = readdirSync(join(ROOT, 'frontend', 'e2e-live')).filter((f) => f.endsWith('.spec.mjs')).map((f) => f.replace('.spec.mjs', '')).sort();
export const SMOKE = ['site', 'home', 'simple']; // the site shell and sign-in, the home page, the easy dashboard
export const MAX = 10;
// path words that name a spec family differently
const ALIAS = { autoapply: 'auto-apply', companies: 'company', jobsearch: 'job', orgs: 'org', recruiters: 'recruiter', simple: 'simple', linkedin: 'linkedin', kiosk: 'kiosk', interview: 'interview', certs: 'cert' };
// words too common to pick anything by
const SKIP = new Set(['src', 'app', 'pages', 'lib', 'tests', 'test', 'frontend', 'backend', 'index', 'main', 'router', 'model', 'models', 'service', 'utils', 'common', 'live', 'admin', 'e2e', 'spec', 'json', 'i18n', 'styles', 'base', 'components', 'helpers', 'scripts', 'github', 'workflows', 'docs', 'readme']);

const words = (path) => path.replace(/\.[a-z]+$/i, '').split(/[/._-]+/).flatMap((p) => p.split(/(?=[A-Z])/)).map((w) => w.toLowerCase()).filter((w) => w.length >= 4 && !SKIP.has(w)).map((w) => ALIAS[w] || w);

export function pick(changed) {
  const out = new Set(SMOKE.filter((s) => SPECS.includes(s)));
  const own = changed.map((f) => (/frontend\/e2e-live\/(.+)\.spec\.mjs$/.exec(f) || [])[1]).filter((s) => s && SPECS.includes(s));
  own.forEach((s) => out.add(s));
  const score = new Map();
  for (const f of changed) {
    if (/e2e-live\/.+\.spec\.mjs$/.test(f)) continue;
    for (const w of new Set(words(f))) {
      for (const s of SPECS) if (s.includes(w)) score.set(s, (score.get(s) || 0) + 1);
    }
  }
  [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).forEach(([s]) => { if (out.size < MAX) out.add(s); });
  return [...out].slice(0, Math.max(MAX, SMOKE.length + own.length)).map((s) => `e2e-live/${s}.spec.mjs`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const changed = (args.length ? args : readFileSync(0, 'utf8').split('\n')).map((x) => x.trim()).filter(Boolean);
  console.log(pick(changed).join(' '));
}
