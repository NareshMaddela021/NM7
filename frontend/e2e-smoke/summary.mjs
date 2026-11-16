// Prints the smoke results by area: pages checked, passed, failed, flaky (passed on the retry) and skipped, then
// every failure with its first problem lines. Usage: node e2e-smoke/summary.mjs smoke-results.json
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rows = [];
const walk = (suite) => {
  for (const s of suite.suites || []) walk(s);
  for (const spec of suite.specs || []) for (const t of spec.tests) rows.push({ title: spec.title, project: t.projectName, status: t.status, results: t.results });
};
report.suites.forEach(walk);
const areas = {};
const fails = [];
for (const r of rows) {
  if (r.project === 'setup') { if (r.results.some((x) => x.status === 'failed')) fails.push(`setup: ${r.results.at(-1)?.error?.message?.split('\n')[0]}`); continue; }
  const a = r.title.split(' › ')[0];
  const o = (areas[a] ||= { checked: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 });
  if (r.status === 'skipped') { o.skipped += 1; continue; }
  o.checked += 1;
  if (r.status === 'expected') o.passed += 1;
  else if (r.status === 'flaky') { o.passed += 1; o.flaky += 1; fails.push(`FLAKY ${r.project} ${r.title}: ${r.results[0]?.error?.message?.split('\n').slice(0, 6).join(' | ')}`); }
  else { o.failed += 1; fails.push(`FAIL ${r.project} ${r.title}: ${r.results.at(-1)?.error?.message?.split('\n').slice(0, 12).join(' | ')}`); }
}
// why signed-in areas were skipped
try { const info = JSON.parse(readFileSync('e2e-smoke/.state/info.json', 'utf8')); if (info.adminError) fails.push(`setup: admin sign-in failed: ${info.adminError}`); for (const [k, v] of Object.entries(info.demos || {})) if (v.error) fails.push(`setup: demo ${k} not opened: ${v.error}`); if (!info.admin && !info.adminError) fails.push('setup: no live admin secrets, so only the public pages were checked'); } catch { /* no setup */ }
const total = Object.values(areas).reduce((n, o) => n + o.checked, 0);
console.log(`## Live smoke check: ${total} page checks\n\n| Area | Checked | Passed | Failed | Flaky | Skipped |\n|---|---|---|---|---|---|`);
for (const [a, o] of Object.entries(areas)) console.log(`| ${a} | ${o.checked} | ${o.passed} | ${o.failed} | ${o.flaky} | ${o.skipped} |`);
console.log(fails.length ? `\n### Problems\n\n${fails.map((f) => `- ${f.split(String.fromCharCode(27)).map((s, i) => (i ? s.replace(/^\[[0-9;]*m/, '') : s)).join('')}`).join('\n')}` : '\nNo problems.');
