import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { CompanyTerms, Contact, DeliveryPolicy, ExpertTerms, Privacy, RefundPolicy, Terms } from './Legal';
import SiteFooter from '../../components/SiteFooter';
import { LEGAL, LEGAL_UPDATED, missingLegal } from '../../lib/legal';

const html = (C) => renderToStaticMarkup(<MemoryRouter><C /></MemoryRouter>);
const PAGES = { Terms, Privacy, RefundPolicy, DeliveryPolicy, ExpertTerms, CompanyTerms, Contact };

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
  it('the registered office and the Grievance Officer are filled in (email only, no phone)', () => {
    const missing = missingLegal();
    expect(missing).not.toContain('Registered office address');
    expect(missing).not.toContain('Grievance Officer name');
    expect(missing).toContain('TDS rate on expert payouts');
    expect(missing).not.toContain('Support phone number');
    expect(missing).not.toContain('Grievance Officer phone');
  });
  it('shows a detail once it is filled in', () => {
    const was = LEGAL.address;
    LEGAL.address = '1 MG Road, Bengaluru 560001';
    try {
      expect(html(Terms)).toContain('Registered office: 1 MG Road');
    } finally { LEGAL.address = was; }
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
    expect(contact).toContain('Bengaluru, Karnataka 560066, India');
    expect(contact).not.toMatch(/Phone/);
  });

  it('Terms, Privacy, Refunds and Company terms share one "Last updated" date; Delivery and Expert terms keep theirs', () => {
    for (const C of [Terms, Privacy, RefundPolicy, CompanyTerms]) expect(html(C)).toContain(`Last updated · ${LEGAL_UPDATED}`);
    for (const C of [DeliveryPolicy, ExpertTerms]) expect(html(C)).toContain(`Last updated · ${LEGAL.updated}`);
  });
  it('the registered office, the named Grievance Officer and Bengaluru courts are on Terms, Privacy and Company terms', () => {
    for (const C of [Terms, Privacy, CompanyTerms]) {
      const out = html(C);
      expect(out).toContain('BHIVE Premium Whitefield Campus, Plot No. 77, JBR Tech Park, 6th Rd, Whitefield, EPIP Zone, Bengaluru, Karnataka 560066, India');
      expect(out).toContain('Grievance Officer: Naresh Maddela, Founder &amp; CEO · info@nm7.si.');
      expect(out).not.toMatch(/asuraa\.in/i);
    }
    expect(html(Terms)).toContain('Courts in Bengaluru, Karnataka have jurisdiction');
    expect(html(CompanyTerms)).toContain('Courts in Bengaluru, Karnataka have jurisdiction');
  });
  it('/privacy has the Nm7 Apply helper section at id="extension" (nm7.si/privacy#extension), with the Limited Use line', () => {
    const out = html(Privacy);
    expect(out).toMatch(/<section id="extension"[^>]*><h2[^>]*>\d+\. Nm7 Apply helper \(Chrome extension\)<\/h2>/);
    expect(out).toContain('href="#extension"');
    expect(out).toContain('The use of information received from Nm7 Apply helper will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.');
    for (const p of ['activeTab', 'chrome.storage.local', 'nm7-api.onrender.com', 'never presses Submit', 'never reads your other tabs or your browsing history', 'no analytics']) expect(out).toContain(p);
  });
  it('/privacy names the AI provider and the other processors', () => {
    const out = html(Privacy);
    for (const p of ['Anthropic', 'Google', 'Razorpay', 'Resend', 'Hygraph', 'Vercel', 'Render', 'MongoDB Atlas', 'Amazon Web Services', 'Setu', 'Sentry']) expect(out).toContain(p);
    expect(out).toContain('apply.nm7.si');
    expect(out).toContain('manual check');
  });
  it('/company-terms renders the rules for companies and colleges', () => {
    const out = html(CompanyTerms);
    expect(out).toContain('Terms for companies and colleges');
    for (const p of ['Posting jobs', 'Never ask candidates for money', 'Candidate data: only for hiring', 'Never sell, rent or give candidate data', 'Drive days and colleges', 'Demo accounts', 'Job removal', 'Plans and payments']) expect(out).toContain(p);
  });
  it('the footer links Company terms right after Expert terms', () => {
    const out = renderToStaticMarkup(<MemoryRouter><SiteFooter /></MemoryRouter>);
    expect(out).toMatch(/<a href="\/expert-terms"[^>]*>Expert terms<\/a><a href="\/company-terms"[^>]*>Company terms<\/a>/);
  });
  it('Refunds: company features are free and organization plans have their own rules', () => {
    const out = html(RefundPolicy);
    expect(out).toContain('Plans for colleges and organizations');
    expect(out).toContain('Nm7 takes no payment from companies');
  });
  it('no line is left as a decision to confirm ("?? "): every business decision is final', () => {
    const src = readFileSync(new URL('./Legal.jsx', import.meta.url), 'utf8');
    expect(src).not.toMatch(/['`]\?\? [A-Z]/);
  });
});
