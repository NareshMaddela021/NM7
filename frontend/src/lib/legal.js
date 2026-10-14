// Business details for the legal pages, contact page, footer and invoices — the ONE place to fill them in.
// Leave a value '' until you have it: every sentence or line that needs it is hidden (no [brackets] on the site).
// `missingLegal()` lists what is still empty (shown in the preview build only).
export const LEGAL = {
  company: 'AsuraaX AI',
  entity: '', // legal form, e.g. 'Private Limited Company' / 'LLP' / 'Sole proprietorship'
  brands: 'Nm7 (nm7.si) and asuraa.ai',
  site: 'nm7.si',
  brand: 'Nm7',
  email: 'info@nm7.si',
  address: '', // registered office, full postal address
  city: 'Bengaluru, Karnataka, India',
  phone: '', // support phone / WhatsApp number
  hours: 'Monday–Saturday, 10 am – 7 pm IST',
  grievance: { name: '', email: '', phone: '' }, // Grievance Officer (Consumer Protection E-Commerce Rules, DPDP Act)
  courts: 'Bengaluru, Karnataka',
  updated: '14 October 2026',
  gstin: '', // printed on invoices
  sacCode: '', // SAC code for the service, printed on invoices
  tdsRate: '', // TDS on expert payouts, e.g. '1% under section 194-O' (ask your CA)
  hosting: '', // where data is hosted, e.g. 'Render and MongoDB Atlas (Singapore), Vercel (global)'
  supportRetention: '', // how long support messages are kept, e.g. '2 years'
  diyFixTime: '', // how long you have to fix a DIY tool problem before refunding, e.g. '48 hours'
};

const LABELS = {
  entity: 'Legal form of the company', address: 'Registered office address', phone: 'Support phone number',
  'grievance.name': 'Grievance Officer name', 'grievance.email': 'Grievance Officer email', 'grievance.phone': 'Grievance Officer phone',
  gstin: 'GSTIN', sacCode: 'SAC code', tdsRate: 'TDS rate on expert payouts', hosting: 'Hosting providers and countries',
  supportRetention: 'How long support messages are kept', diyFixTime: 'Time to fix a DIY tool problem before refunding',
};
/** Fields still empty, with plain-language names. */
export function missingLegal(l = LEGAL) {
  return Object.entries(LABELS).filter(([k]) => !k.split('.').reduce((o, p) => o?.[p], l)).map(([, label]) => label);
}
/** Joins the parts that have a value: join(' · ', a, b, c). */
export const join = (sep, ...parts) => parts.filter(Boolean).join(sep);
