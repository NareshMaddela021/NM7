import { describe, expect, it } from 'vitest';
import { webLink } from './links';

describe('job links', () => {
  it('keeps web links, adds https:// to bare domains', () => {
    expect(webLink('')).toBe('');
    expect(webLink(' careers.zoho.com/jobs/1 ')).toBe('https://careers.zoho.com/jobs/1');
    expect(webLink('http://zoho.com/x')).toBe('http://zoho.com/x');
    expect(webLink('HTTPS://zoho.com')).toBe('HTTPS://zoho.com');
  });
  it('refuses scripts and other schemes', () => {
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,hi', 'ftp://x.com', '//evil.com', 'not a link', 'https://', 'vbscript:x']) expect(webLink(bad), bad).toBe(null);
  });
});

import { uniqueName } from '../pages/Builder';
describe('new resume names', () => {
  it('never repeat', () => {
    const rs = [{ name: 'QA · from Job Profile · 15 Oct' }, { name: 'QA · from Job Profile · 15 Oct (2)' }];
    expect(uniqueName('Other', rs)).toBe('Other');
    expect(uniqueName('QA · from Job Profile · 15 Oct', rs)).toBe('QA · from Job Profile · 15 Oct (3)');
  });
});
