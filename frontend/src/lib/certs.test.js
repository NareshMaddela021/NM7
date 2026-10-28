import { describe, expect, it } from 'vitest';
import { addToResume, certEntry, fileProblem, kb } from './certs';

const f = (name, type, size = 1000) => ({ name, type, size });

describe('certificate wallet helpers', () => {
  it('accepts PDF, JPG and PNG only, and refuses ID documents', () => {
    expect(fileProblem(null)).toMatch(/Choose/);
    expect(fileProblem(f('a.gif', 'image/gif'))).toMatch(/PDF, JPG or PNG/);
    expect(fileProblem(f('cert.pdf', 'application/pdf'), 'Python')).toBe('');
    expect(fileProblem(f('aadhaar.jpg', 'image/jpeg'), 'Me')).toMatch(/Don’t upload Aadhaar, PAN/);
    expect(fileProblem(f('x.png', 'image/png'), 'My PAN card')).toMatch(/Aadhaar, PAN/);
    expect(fileProblem(f('big.pdf', 'application/pdf', 3 * 1024 * 1024), 'Python')).toMatch(/over 2 MB/);
    expect(fileProblem(f('big.jpg', 'image/jpeg', 5 * 1024 * 1024), 'Python')).toBe(''); // shrunk before upload
  });

  it('adds a certificate to Certifications once, filling an empty starter row', () => {
    const c = { title: 'Python for Data Science', issuer: 'NPTEL', date: '2024-05', link: 'https://nptel.ac.in/x' };
    expect(certEntry(c)).toMatchObject({ name: 'Python for Data Science', issuer: 'NPTEL', issueDate: '2024-05', links: [{ label: 'Credential', url: 'https://nptel.ac.in/x' }] });
    const first = addToResume({ certs: [{ name: '' }] }, c);
    expect(first.added).toBe(true);
    expect(first.data.certs).toHaveLength(1);
    const again = addToResume(first.data, { ...c, title: ' python for data science ' });
    expect(again.added).toBe(false);
    expect(addToResume({ certs: [{ name: 'AWS' }] }, c).data.certs.map((x) => x.name)).toEqual(['AWS', 'Python for Data Science']);
  });

  it('shows sizes simply', () => {
    expect(kb(300)).toBe('1 KB');
    expect(kb(250 * 1024)).toBe('250 KB');
    expect(kb(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
});
