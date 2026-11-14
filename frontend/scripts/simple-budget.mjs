// The Easy dashboard's size budget (Phase 4): the JavaScript a phone downloads to open /me/simple, gzipped, must stay
// under 150 KB, in English and in Telugu / Hindi (their strings load when that language is on). Run after the build:
//   npm run build && npm run budget
// It follows the built files: the entry script in dist/index.html and everything it imports statically, plus the
// /me/simple chunk (SimpleApp) and its static imports, plus the largest language's strings (pages.json and home.json). The resume questions
// and the jobs screens load later, when they open; their sizes are printed too. A rough slow-3G time is printed
// (400 kbit/s, 400 ms round trips: 3 round trips + the bytes).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
export const BUDGET = 150 * 1024;
const DIST = join(here, '..', 'dist');
const ASSETS = join(DIST, 'assets');

const gz = (f) => gzipSync(readFileSync(join(ASSETS, f)), { level: 9 }).length;
const staticImports = (f) => [...readFileSync(join(ASSETS, f), 'utf8').matchAll(/(?:import|from)\s*["']\.\/([\w.-]+\.js)["']/g)].map((m) => m[1]);

export function closure(starts) {
  const seen = new Set();
  const todo = [...starts];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    todo.push(...staticImports(f));
  }
  return seen;
}

export function measure() {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const entry = html.match(/<script[^>]+src="\/assets\/([\w.-]+\.js)"/)[1];
  const files = readdirSync(ASSETS);
  const pick = (prefix) => files.filter((f) => f.startsWith(prefix) && f.endsWith('.js'));
  const simple = pick('SimpleApp-');
  if (simple.length !== 1) throw new Error(`expected one SimpleApp chunk, found ${simple.length}`);
  const route = closure([entry, simple[0]]);
  const base = [...route].reduce((a, f) => a + gz(f), 0);
  // the larger language's strings: its pages.json part and its home.json part (each a chunk of its own, round L)
  const strings = Math.max(0, ...pick('pages-').map(gz)) + Math.max(0, ...pick('home-').map(gz));
  const later = Object.fromEntries(['GuidedResume-', 'SimpleJobs-'].map((p) => [p.slice(0, -1), pick(p).reduce((a, f) => a + gz(f), 0)]));
  // the new home page (/new-home): its own chunk, and the 3D dots (three.js) in another one loaded after the first paint;
  // neither may ever be part of the main bundle
  const entryFiles = closure([entry]);
  const newHome = pick('NewHome-');
  const particles = pick('particles-');
  const leaked = [...entryFiles].filter((f) => f.startsWith('NewHome-') || f.startsWith('particles-'));
  const page = newHome.length ? [...closure(newHome)].filter((f) => !entryFiles.has(f) && !f.startsWith('particles-')).reduce((a, f) => a + gz(f), 0) : 0;
  return { files: [...route].sort(), english: base, telugu: base + strings, later, newHome: { page, threeD: particles.reduce((a, f) => a + gz(f), 0), leaked } };
}

export const NEW_HOME_BUDGET = 40 * 1024; // the page's own JavaScript on top of the main bundle, before the 3D

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
export const slow3g = (bytes) => 3 * 0.4 + bytes / (400_000 / 8); // seconds

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const m = measure();
  console.log(`/me/simple JavaScript (gzip): English ${kb(m.english)} · Telugu / Hindi ${kb(m.telugu)} (budget ${kb(BUDGET)})`);
  console.log(`  later, when opened: resume questions ${kb(m.later.GuidedResume)} · jobs screens ${kb(m.later.SimpleJobs)}`);
  console.log(`  slow 3G estimate: English ${slow3g(m.english).toFixed(1)} s · Telugu / Hindi ${slow3g(m.telugu).toFixed(1)} s (first visit, nothing cached)`);
  console.log(`  files: ${m.files.join(', ')}`);
  console.log(`/new-home JavaScript (gzip): the page ${kb(m.newHome.page)} (budget ${kb(NEW_HOME_BUDGET)}) · 3D, loaded after the first paint ${kb(m.newHome.threeD)}`);
  if (m.newHome.leaked.length) { console.error(`The new home page or its 3D is in the main bundle: ${m.newHome.leaked.join(', ')}`); process.exit(1); }
  if (m.newHome.page > NEW_HOME_BUDGET) { console.error('Over the new home page budget.'); process.exit(1); }
  if (m.english > BUDGET || m.telugu > BUDGET) { console.error('Over the Easy dashboard budget.'); process.exit(1); }
}
