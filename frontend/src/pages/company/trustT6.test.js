// Vetting Trust T6: the job form's question body (templates kept), the live warning for questions about the person
// rather than the work (the server's patterns), and the Hire now query with the non-tech filters.
import { describe, expect, it } from 'vitest';
import { questionsBody, unfairTopic } from './CompanyJobs';
import { shortlistQuery } from './CompanyHire';
import { NT_NONE, nonTechQuery, ntOn } from './HireNonTech';

// the same shape GET /api/company/{cid}/trust/knockouts sends (a few of the patterns)
const KO = {
  patterns: {
    gender: '\\b(?:gender|male|female|boys?|girls?)\\b',
    marital: '\\b(?:marri(?:ed|age)|marital|spouse|are you single)\\b',
    age: '\\b(?:age|aged|how old|date of birth|dob)\\b',
    photo: '\\b(?:photo(?:graph)?s?|selfie)\\b',
  },
  labels: { gender: 'gender', marital: 'marital status', age: 'age', photo: 'photos or looks' },
};

describe('T6 job form', () => {
  it('keeps the template a question came from', () => {
    const body = questionsBody([
      { text: 'Are you willing to work night shifts?', kind: 'yesno', want: 'yes', options: '', min: '', accept: '', template: 'night_shift' },
      { text: 'Which shift suits you?', kind: 'choice', options: 'Day, Night', accept: 'Night', want: '', min: '', template: '' },
    ]);
    expect(body[0]).toEqual({ text: 'Are you willing to work night shifts?', kind: 'yesno', want: 'yes', template: 'night_shift' });
    expect(body[1]).toEqual({ text: 'Which shift suits you?', kind: 'choice', options: ['Day', 'Night'], accept: ['Night'] });
  });
  it('warns on questions about the person, not the work', () => {
    expect(unfairTopic(KO, { text: 'Are you married?', options: '' })).toBe('marital');
    expect(unfairTopic(KO, { text: 'Pick one', options: 'Male, Female' })).toBe('gender');
    expect(unfairTopic(KO, { text: 'Send a recent PHOTO', options: '' })).toBe('photo');
    expect(unfairTopic(KO, { text: 'Can you manage a team?', options: '' })).toBe('');
    expect(unfairTopic(KO, { text: 'Which language do you speak?', options: '' })).toBe('');
    expect(unfairTopic(null, { text: 'Are you married?', options: '' })).toBe(''); // switch OFF: as before
  });
});

describe('T6 Hire now filters', () => {
  it('sends only the filters that are on', () => {
    expect(shortlistQuery('j1')).toBe('job=j1&size=100');
    const q = new URLSearchParams(shortlistQuery('j1', {}, { ...NT_NONE, licence: 'two_wheeler', nightShift: true, maxKm: '5', lang: 'Telugu', immediate: true }));
    expect(Object.fromEntries(q)).toEqual({ job: 'j1', size: '100', licence: 'two_wheeler', nightShift: 'true', maxKm: '5', lang: 'Telugu', immediate: 'true' });
    expect(nonTechQuery(new URLSearchParams(), { ...NT_NONE, maxKm: '0', vehicle: 'car', shift: 'day' }).toString()).toBe('vehicle=car&shift=day');
    expect(ntOn(NT_NONE)).toBe(false);
    expect(ntOn({ ...NT_NONE, maxKm: '10' })).toBe(true);
  });
});
