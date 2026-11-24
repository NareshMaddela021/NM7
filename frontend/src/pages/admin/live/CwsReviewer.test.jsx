// Admin -> Auto Apply -> "Chrome Web Store reviewer": create the account, then the password stays hidden until
// "Show password", with Copy and Reset password. The card never holds a password the server didn't give it.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewerCard } from './CwsReviewer';
import { actionWords } from '../../../lib/activityWords';

const d = { exists: true, email: 'chrome-review@nm7.si', loginUrl: 'https://nm7.si/login', fromServer: false, passwordSetAt: 1,
  practice: [{ title: 'Junior Data Analyst', url: 'https://nm7.si/demo/apply/junior-data-analyst' }, { title: 'Customer Support Executive', url: 'https://nm7.si/demo/apply/customer-support-executive' }] };
const card = (props) => renderToStaticMarkup(<ReviewerCard d={d} password="" busy={false} onShow={vi.fn()} onHide={vi.fn()} onReset={vi.fn()} onCopy={vi.fn()} {...props} />);

describe('Chrome Web Store reviewer card', () => {
  it('offers to create the account when there is none', () => {
    const html = card({ d: { ...d, exists: false } });
    expect(html).toContain('Create the reviewer account');
    expect(html).not.toContain('Show password');
  });

  it('hides the password until Show password, then offers Copy and Reset password', () => {
    const hidden = card();
    expect(hidden).toContain('chrome-review@nm7.si');
    expect(hidden).toContain('Show password');
    expect(hidden).toContain('Reset password');
    expect(hidden).not.toContain('aa-cws-password');
    expect(hidden).toContain('https://nm7.si/demo/apply/junior-data-analyst');
    const shown = card({ password: 'Abcdef-Ghijk2-Mnopq3-Rstuv4' });
    expect(shown).toContain('Abcdef-Ghijk2-Mnopq3-Rstuv4');
    expect(shown).toContain('Copy password');
    expect(shown).not.toContain('Show password');
    expect(card({ fromServer: true, d: { ...d, fromServer: true } })).toContain('CWS_REVIEWER_PASSWORD');
  });

  it('the activity log says it in plain words', () => {
    expect(actionWords('auto_apply.cws_reviewer_created')).toBe('Chrome Web Store reviewer account created');
    expect(actionWords('auto_apply.cws_reviewer_password')).toBe('Chrome Web Store reviewer password reset');
    expect(actionWords('auto_apply.cws_reviewer_password_shown')).toBe('Chrome Web Store reviewer password shown');
  });
});
