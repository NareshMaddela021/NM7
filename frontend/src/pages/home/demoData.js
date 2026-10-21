// Sample resumes for the home page demos (a made-up candidate, clearly sample data).
import { INITIAL } from '../builder/schema';
import { TEMPLATE_PRESETS } from '../builder/design';

export const DEMO_JD = 'Data Analyst (0–1 years): SQL, Python, Pandas, Excel, Power BI or Tableau, dashboards, KPI tracking, data cleaning, stakeholder communication.';

const base = structuredClone(INITIAL);
export const BEFORE = {
  ...base,
  personal: { ...base.personal, name: 'Sai Varsha', headline: '' },
  summary: 'Seeking a challenging role in a reputed organisation where I can grow my skills and contribute to the company.',
  exp: [{ ...base.exp[0], description: 'made dashboards in power bi for sales team\ncleaned csv files in python\nhelped with weekly reports' }],
  proj: [{ ...base.proj[0], tagline: '', description: 'made a dashboard for college fest', tech: 'Power BI' }],
  skillGroups: base.skillGroups.map((g) => ({ ...g, value: g.id === 'core' ? 'Python, SQL, Excel' : '' })),
  certs: [], links: { ...base.links, linkedin: '' },
  design: { ...TEMPLATE_PRESETS.fresher.design, preset: 'fresher' },
};
export const AFTER = {
  ...base,
  personal: { ...base.personal, name: 'Sai Varsha', headline: 'Data Analyst · SQL · Python · Power BI' },
  summary: 'Data analyst fresher who turns raw sales data into dashboards teams use every week. Skilled in SQL, Python (Pandas), Excel and Power BI. Cut weekly reporting from 5 hours to 30 minutes during my internship. Looking for a Data Analyst role in a product-led team.',
  exp: [{ ...base.exp[0], description: 'Built 6 Power BI dashboards for a 12-person sales team, cutting weekly reporting from 5 hours to 30 minutes\nCleaned and merged 40+ CSV files (1.2 lakh rows) in Python (Pandas), removing 3,000 duplicate records\nPresented weekly KPI trends to the sales head; 2 insights fed into the next quarter’s targets' }],
  proj: [{ ...base.proj[0], description: 'Built a sponsor-sales dashboard used by a 15-member fest committee to track ₹4 lakh in sponsorships\nModelled data in SQL and automated daily refresh from Google Sheets' }],
  design: { ...TEMPLATE_PRESETS.fresher.design, preset: 'fresher' },
};

export { EXAMPLES, bulletScore, improveBullet } from './lineFixer';
