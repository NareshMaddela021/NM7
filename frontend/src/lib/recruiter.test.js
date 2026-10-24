import { describe, expect, it } from 'vitest';
import { filterCandidates, isRecruiterToken, pdfName, shortlistChoices } from './recruiter';

const list = [
  { id: 'a', name: 'Asha Rao', headline: 'Data analyst', answers: { Branch: 'CSE' }, interested: false },
  { id: 'b', name: 'Ravi Kumar', headline: 'Electrician', answers: { Branch: 'EEE', 'Preferred location': 'Hyderabad' }, interested: true },
  { id: 'c', name: 'Meena S', headline: '', answers: {}, interested: true },
];

describe('recruiter link filtering', () => {
  it('searches names, headlines and answers (every word must match)', () => {
    expect(filterCandidates(list, { q: 'eee' }).map((c) => c.id)).toEqual(['b']);
    expect(filterCandidates(list, { q: 'ravi hyderabad' }).map((c) => c.id)).toEqual(['b']);
    expect(filterCandidates(list, { q: 'analyst' }).map((c) => c.id)).toEqual(['a']);
    expect(filterCandidates(list, { q: '  ' })).toHaveLength(3);
    expect(filterCandidates(list, { q: 'nobody' })).toEqual([]);
  });
  it('“Interested only” keeps the ticked candidates', () => {
    expect(filterCandidates(list, { interestedOnly: true }).map((c) => c.id)).toEqual(['b', 'c']);
    expect(filterCandidates(list, { interestedOnly: true, q: 'meena' }).map((c) => c.id)).toEqual(['c']);
    expect(filterCandidates(null)).toEqual([]);
  });
  it('tells recruiter tokens from resume link names', () => {
    expect(isRecruiterToken('sai-varsha')).toBe(false);
    expect(isRecruiterToken('a'.repeat(40))).toBe(false); // the longest resume link name
    expect(isRecruiterToken('Xy_9-'.repeat(9).slice(0, 43))).toBe(true);
  });
  it('makes safe file names and the shortlist filter choices', () => {
    expect(pdfName('Asha  Rao / CSE')).toBe('Asha_Rao_CSE_Resume.pdf');
    expect(shortlistChoices([{ id: '1', company: 'Acme', label: '', shortlisted: 2 }, { id: '2', company: 'Beta', shortlisted: 0 }])).toEqual([{ id: '1', label: 'Acme' }]);
  });
});
