// The server's ATS score (backend/app/orgs/ats.py, used by organization dashboards and the recruiter portal) must
// give the same number as the student's ATS check. Both sides read the same cases.
import { describe, expect, it } from 'vitest';
import cases from '../../../backend/tests/fixtures/ats_cases.json';
import { atsScore } from './atsScore';

describe('ATS score parity with the server', () => {
  for (const c of cases) {
    it(c.name, () => { expect(atsScore(c.data).score).toBe(c.score); });
  }
});
