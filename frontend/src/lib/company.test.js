// Company sign-up checks in the browser: the same GSTIN check character, CIN and LLPIN formats as the server, and the
// body sent for a company vs an individual recruiter (no registration, no website, LinkedIn + declaration).
import { describe, expect, it } from 'vitest';
import { companyBody, gstinCheckChar, registrationProblem } from './company';

describe('registration numbers', () => {
  it('GSTIN: format, state code and check character', () => {
    for (const g of ['27AAPFU0939F1ZV', '29AAGCB7383J1Z4', '33AAACH7409R1Z8']) expect(registrationProblem('gstin', g)).toBe('');
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
    expect(registrationProblem('gstin', ' 27aapfu0939f1zv ')).toBe('');
    expect(registrationProblem('gstin', '27AAPFU0939F1ZW')).toBe('co.reg.err.gstinCheck');
    expect(registrationProblem('gstin', '45AAPFU0939F1ZV')).toBe('co.reg.err.gstinState');
    expect(registrationProblem('gstin', '27AAPFU0939')).toBe('co.reg.err.gstinFormat');
    expect(registrationProblem('gstin', '')).toBe('co.reg.err.empty');
  });
  it('CIN and LLPIN', () => {
    expect(registrationProblem('cin', 'U72900TG2019PTC123456')).toBe('');
    expect(registrationProblem('cin', 'U72900TG2019XYZ123456')).toBe('co.reg.err.cin');
    expect(registrationProblem('llpin', 'AAB-1234')).toBe('');
    expect(registrationProblem('llpin', 'AAB1234')).toBe('co.reg.err.llpin');
  });
});

describe('the body sent to the API', () => {
  const base = { details: { legalName: 'Acme', website: 'acme.com', category: 'startup' }, registration: { kind: 'gstin', number: '27aapfu0939f1zv ' }, individual: { linkedin: 'x', declared: true }, phone: '' };
  it('a company sends its registration, not the individual part', () => {
    const b = companyBody(base);
    expect(b.registration).toEqual({ kind: 'gstin', number: '27AAPFU0939F1ZV' });
    expect(b.individual).toBeNull();
  });
  it('an individual recruiter sends LinkedIn + declaration, no registration, no website', () => {
    const b = companyBody({ ...base, details: { ...base.details, category: 'individual' } });
    expect(b.registration).toBeNull();
    expect(b.details.website).toBe('');
    expect(b.individual).toEqual({ linkedin: 'x', declared: true });
  });
});
