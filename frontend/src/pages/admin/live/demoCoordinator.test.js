// Batch A item 2: Admin > Organizations > demo college "Reset and open as coordinator" asks with the site's own
// dialog (a native confirm() froze the page) and then opens the college the way "Switch to > College view" does.
// Batch A item 3: the selfie gate before a test or interview always has "No camera right now: take it now, check later".
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const org = readFileSync(new URL('./OrgPages.jsx', import.meta.url), 'utf8');
const demo = org.slice(org.indexOf('export function DemoOrg'), org.indexOf('const PLAN_TONE'));
const face = readFileSync(new URL('../../me/trust/FaceCheck.jsx', import.meta.url), 'utf8');
const skill = readFileSync(new URL('../../me/MeSkillChecks.jsx', import.meta.url), 'utf8');
const iv = readFileSync(new URL('../../me/MeInterviews.jsx', import.meta.url), 'utf8');

describe('demo college: reset and open as coordinator', () => {
  it('never uses a native confirm and asks in the site dialog', () => {
    expect(demo).not.toMatch(/window\.confirm|confirm\(/);
    expect(demo).toContain('<Dialog title="Reset and open as coordinator"');
    expect(demo).toContain('data-testid="demo-as-coordinator-yes"');
  });
  it('resets, then opens the college like Switch to > College view', () => {
    expect(demo).toMatch(/http\('\/api\/admin\/demo-org', \{ method: 'POST' \}\); await switchTo\('college'\)/);
    expect(org).toContain("import { switchTo } from '../../../lib/adminViews';");
  });
});

describe('selfie gate never blocks someone without a camera', () => {
  it('offers to take it now and check later', () => {
    expect(face).toContain('data-testid="fc-later-go"');
    expect(face).toMatch(/onLater && !joining/);
    for (const page of [skill, iv]) expect(page).toContain('begin({ ...b, noCamera: true })');
  });
});
