// CI_MODE=light: the quick check on pull requests runs the smoke set and the specs related to the change
// (.github/scripts/pick-e2e.mjs); the whole suite runs nightly and by hand.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX, SMOKE, pick } from '../../../.github/scripts/pick-e2e.mjs';

const E2E = join(__dirname, '..', '..', 'e2e-live');

describe('quick e2e pick', () => {
  it('always the smoke set, every spec exists', () => {
    const out = pick([]);
    expect(out).toEqual(SMOKE.map((s) => `e2e-live/${s}.spec.mjs`));
    for (const f of pick(['frontend/src/pages/company/CompanySignup.jsx'])) expect(existsSync(join(E2E, '..', f)), f).toBe(true);
  });
  it('a changed spec runs; specs named like the changed code run; at most MAX', () => {
    const out = pick(['frontend/e2e-live/retest-wording.spec.mjs', 'frontend/src/pages/company/CompanySignup.jsx', 'backend/app/autoapply/engine.py']);
    expect(out).toContain('e2e-live/retest-wording.spec.mjs');
    expect(out).toContain('e2e-live/company-signup.spec.mjs');
    expect(out.some((f) => f.includes('auto-apply'))).toBe(true);
    expect(out.length).toBeLessThanOrEqual(MAX);
  });
  it('pull requests: the quick job in light mode (the default), the whole suite with CI_MODE=full; nightly and by hand: the whole suite', () => {
    const y = readFileSync(join(__dirname, '..', '..', '..', '.github', 'workflows', 'e2e.yml'), 'utf8');
    // light is the default (CI_MODE unset or light); CI_MODE=full brings the whole suite back to every pull request
    expect(y).toMatch(/quick:\n\s+# [^\n]*\n\s+if: github.event_name == 'pull_request' && vars.CI_MODE != 'full'/);
    expect(y).toMatch(/live:\n\s+# [^\n]*\n\s+if: github.event_name != 'pull_request' \|\| vars.CI_MODE == 'full'/);
    expect(y).toContain('workflow_dispatch:');
    expect(y).toMatch(/schedule:\n\s+- cron:/);
  });
});
