import { describe, expect, it } from 'vitest';
import { TIP, localBullets } from './projectHelper';

const A = { built: 'a college attendance app', tools: 'Flutter, Firebase', part: 'the login and attendance screens', team: '3', does: 'lets teachers mark attendance from their phone', result: '' };

describe('project helper rules (same as the server)', () => {
  it('writes bullets only from the answers, with the number tip when there is no number', () => {
    expect(localBullets(A, 'Attendance')).toEqual({
      bullets: [
        'Built a college attendance app using Flutter and Firebase',
        'Project lets teachers mark attendance from their phone',
        'Handled the login and attendance screens in a team of 3',
      ],
      tip: TIP,
      note: '',
    });
  });
  it('keeps a real result and drops the tip', () => {
    const r = localBullets({ ...A, result: 'cut marking time from 10 minutes to 2' });
    expect(r.bullets).toHaveLength(4);
    expect(r.bullets[3]).toBe('Result: cut marking time from 10 minutes to 2');
    expect(r.tip).toBeNull();
  });
  it('a solo project and the title when nothing else is given', () => {
    expect(localBullets({ part: 'everything', team: '1' }, 'Chat app').bullets).toEqual(['Built Chat app', 'Handled everything']);
  });
});
