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
  it.each([['Terms', Terms], ['Privacy', Privacy]])('%s says how a company has a job removed, with a working link (round J2)', (_, C) => {
    const out = html(C);
    expect(out).toContain('Some jobs on Nm7 come from companies’ own careers pages.');
    expect(out).toMatch(/<a href="\/contact\?topic=job-removal"[^>]*>nm7\.si\/contact\?topic=job-removal<\/a>; we remove it, usually within 2 working days\./);
  });
  it('lists the details the owner still has to fill in (no phone is needed)', () => {
    expect(missingLegal()).toEqual(expect.arrayContaining(['Registered office address', 'Grievance Officer name', 'TDS rate on expert payouts']));
    expect(missingLegal()).not.toContain('Support phone number');
  });
  it('shows a detail once it is filled in', () => {
    LEGAL.address = '1 MG Road, Bengaluru 560001';
    try {
      expect(html(Terms)).toContain('Registered office: 1 MG Road');
    } finally { LEGAL.address = ''; }
  });
  it('payments are Razorpay only: no WhatsApp payments, no placeholders, email and city on Contact', () => {
    const terms = html(Terms);
    expect(terms).toContain('AsuraaX AI Private Limited');
    expect(terms).toMatch(/UPI, card, netbanking or wallet/);
    expect(terms).toMatch(/include GST/);
    const refund = html(RefundPolicy);
    expect(refund).not.toMatch(/WhatsApp|\?\?/);
    expect(refund).toContain('original payment method');
    expect(refund).toContain('5–7 working days');
    expect(html(DeliveryPolicy)).not.toMatch(/WhatsApp/);
    expect(html(Privacy)).toMatch(/Nm7 never sees your card, UPI or bank details/);
    const contact = html(Contact);
    expect(contact).toContain('info@nm7.si');
    expect(contact).toContain('Bengaluru, Karnataka, India');
    expect(contact).not.toMatch(/Phone/);
  });
});
