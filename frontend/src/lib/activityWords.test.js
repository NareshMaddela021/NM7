import { describe, expect, it } from 'vitest';
import { actionWords } from './activityWords';

describe('activity log in plain words', () => {
  it('known codes have their own words', () => {
    expect(actionWords('hire.invite')).toBe('Invite sent');
    expect(actionWords('drive_create')).toBe('Drive day created');
    expect(actionWords('company.signup')).toBe('Company signed up');
  });
  it('unknown codes become readable words, never the raw code', () => {
    expect(actionWords('auto_apply.pause')).toBe('Auto apply paused');
    expect(actionWords('coupon.bulk_created')).toBe('Coupon bulk created');
    expect(actionWords('plan_extend')).toBe('Plan extended');
    expect(actionWords('daily_report.ai_check')).toBe('Daily report AI checked');
    expect(actionWords('hire.something_new')).toBe('Hire something new');
    expect(actionWords('criteria')).toBe('Criteria');
    for (const c of ['payments.flag_resolved', 'learn.path_edited', 'x_y.z_w']) expect(actionWords(c)).not.toMatch(/[._]/);
    expect(actionWords('')).toBe('');
  });
});
