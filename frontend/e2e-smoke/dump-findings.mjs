// Prints every journey's findings.json (and, with --shots, each screenshot as base64 lines) to the job log, for
// readers who can't download the run's artifact. Only signed-out pages may be dumped with --shots: the log is public.
// Usage: node e2e-smoke/dump-findings.mjs test-results [--shots]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] || 'test-results';
const shots = process.argv.includes('--shots');
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
let files = [];
try { files = walk(root); } catch { /* no results */ }
for (const f of files.filter((x) => x.endsWith('findings.json'))) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  console.log(`FINDINGS ${JSON.stringify(j)}`);
  if (!shots || !/visitor/.test(j.role)) continue;
  for (const x of j.findings) {
    if (!x.screenshot) continue;
    const p = files.find((y) => y.endsWith(x.screenshot.replace(/^test-results\//, '')));
    if (!p) continue;
    const b = readFileSync(p).toString('base64');
    for (let i = 0; i < b.length; i += 60000) console.log(`SHOT ${x.screenshot} ${i / 60000} ${b.slice(i, i + 60000)}`);
  }
}
