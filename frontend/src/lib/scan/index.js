// The free ATS scan, entirely in the browser: read the file → analyze → report. Nothing is uploaded.
import { analyzeResume } from './analyze';
import { extractResume } from './extract';
import { SAMPLE_FILE, SAMPLE_LINES } from './sample';

export { MESSAGES, checkFile } from './extract';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {File|'sample'} source
 * @param {string} role
 * @param {(step:number)=>void} onStep  0 reading · 1 layout · 2 keywords · 3 results · 4 done
 */
export async function runScan(source, role, onStep = () => {}) {
  const sample = source === 'sample';
  onStep(0);
  const started = Date.now();
  const doc = sample
    ? { fileName: SAMPLE_FILE, kind: 'sample', lines: SAMPLE_LINES, layout: { tables: 1 }, pages: 1, links: [], resume: null }
    : await extractResume(source);
  await pause(Math.max(0, 500 - (Date.now() - started)));
  const report = analyzeResume({ lines: doc.lines, role, layout: doc.layout, pages: doc.pages, links: doc.links });
  for (const step of [1, 2, 3]) { onStep(step); await pause(350); }
  onStep(4);
  return { ...report, file: doc.fileName, kind: doc.kind, sample, resume: doc.resume };
}
