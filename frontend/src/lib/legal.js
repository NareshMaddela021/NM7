// Business details for the legal pages, contact page, footer and invoices — the ONE place to fill them in.
// Leave a value '' until you have it: every sentence or line that needs it is hidden (no [brackets] on the site).
// `missingLegal()` lists what is still empty (shown in the preview build only).

/** "Last updated" on Terms, Privacy, Refunds and Terms for companies and colleges: the ONE place to change it (set it
 *  to the day the change goes live). Delivery and Expert terms keep `LEGAL.updated` (they did not change). */
export const LEGAL_UPDATED = '24 November 2026';

export const LEGAL = {
  company: 'AsuraaX AI Private Limited',
  entity: 'Private Limited Company', // legal form
  brands: 'Nm7 (nm7.si) and asuraa.ai',
  site: 'nm7.si',
  brand: 'Nm7',
  email: 'info@nm7.si',
  address: 'BHIVE Premium Whitefield Campus, Plot No. 77, JBR Tech Park, 6th Rd, Whitefield, EPIP Zone, Bengaluru, Karnataka 560066, India', // registered office
  city: 'Bengaluru, Karnataka, India',
  phone: '', // not shown on the site: support is by email (and the Help page)
  hours: 'Monday–Saturday, 10 am – 7 pm IST',
  grievance: { name: 'Naresh Maddela', title: 'Founder & CEO', email: 'info@nm7.si', phone: '' }, // Grievance Officer (Consumer Protection E-Commerce Rules, DPDP Act); email only, no phone
  courts: 'Bengaluru, Karnataka',
  updated: '14 October 2026', // Delivery and Expert terms; the other legal pages use LEGAL_UPDATED
  gstin: '', // printed on invoices
  sacCode: '', // SAC code for the service, printed on invoices
  tdsRate: '', // TDS on expert payouts, e.g. '1% under section 194-O' (ask your CA)
  hosting: 'Vercel for the website, Render (Singapore) for our servers and MongoDB Atlas for the database', // where data is hosted
  supportRetention: '', // how long support messages are kept, e.g. '2 years'
  diyFixTime: '', // how long you have to fix a DIY tool problem before refunding, e.g. '48 hours'
};

const LABELS = {
  entity: 'Legal form of the company', address: 'Registered office address',
  'grievance.name': 'Grievance Officer name', 'grievance.email': 'Grievance Officer email',
  gstin: 'GSTIN', sacCode: 'SAC code', tdsRate: 'TDS rate on expert payouts', hosting: 'Hosting providers and countries',
  supportRetention: 'How long support messages are kept', diyFixTime: 'Time to fix a DIY tool problem before refunding',
};
/** Fields still empty, with plain-language names. */
export function missingLegal(l = LEGAL) {
  return Object.entries(LABELS).filter(([k]) => !k.split('.').reduce((o, p) => o?.[p], l)).map(([, label]) => label);
}
/** Joins the parts that have a value: join(' · ', a, b, c). */
export const join = (sep, ...parts) => parts.filter(Boolean).join(sep);
