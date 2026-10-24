import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Contact, DeliveryPolicy, ExpertTerms, Privacy, RefundPolicy, Terms } from './Legal';
import { LEGAL, missingLegal } from '../../lib/legal';

const html = (C) => renderToStaticMarkup(<MemoryRouter><C /></MemoryRouter>);
const PAGES = { Terms, Privacy, RefundPolicy, DeliveryPolicy, ExpertTerms, Contact };

describe('legal pages', () => {
  it.each(Object.entries(PAGES))('%s shows no [placeholder] brackets and no empty separators', (_, C) => {
    const out = html(C);
    expect(out).not.toMatch(/\[[A-Z][^\]]*\]/);
    expect(out).not.toMatch(/\[(rate|provider|retention|48 hours|Phone|grievance)/i);
    expect(out).not.toMatch(/ · ·|· \.|\(\)/);
  });
  it('lists the details the owner still has to fill in', () => {
    expect(missingLegal()).toEqual(expect.arrayContaining(['Registered office address', 'Grievance Officer name', 'Support phone number', 'Legal form of the company', 'TDS rate on expert payouts']));
  });
  it('shows a detail once it is filled in', () => {
    LEGAL.phone = '+91 90000 12345';
    LEGAL.address = '1 MG Road, Bengaluru 560001';
    try {
      expect(html(Contact)).toContain('+91 90000 12345');
      expect(html(Terms)).toContain('Registered office: 1 MG Road');
    } finally { LEGAL.phone = ''; LEGAL.address = ''; }
  });
});
