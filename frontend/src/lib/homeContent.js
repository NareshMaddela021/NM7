// Home page content you'll want to edit: numbers, reviews, expert cards, social links.
// placeholder: true → shown with a "Sample" tag in the preview and HIDDEN in the live build until you replace it with real data.
export const STATS = [
  { value: '20,000+', label: 'job seekers on Nm7', placeholder: false },
  { value: '[N]', label: 'resumes scanned', placeholder: true },
  { value: '+[N] pts', label: 'average ATS score jump after an expert rewrite', placeholder: true },
  { value: '24–48 h', label: 'expert delivery, or your money back', placeholder: false },
];

// Real reviews only, with the person's permission. Replace these samples before launch.
export const REVIEWS = [
  { name: '[Customer name]', role: 'Data Analyst · fresher', city: 'Chennai', stars: 5, text: '[Their words about the expert rewrite — e.g. what changed and what happened after.]', placeholder: true },
  { name: '[Customer name]', role: 'SDE-1 · 2025 batch', city: 'Hyderabad', stars: 5, text: '[A short quote about the free scan or the builder.]', placeholder: true },
  { name: '[Customer name]', role: 'Business Analyst · 1 yr', city: 'Pune', stars: 4, text: '[A short quote about delivery time or revisions.]', placeholder: true },
];

// Real experts only, with their consent. These are sample cards.
export const EXPERTS = [
  { initials: 'DA', name: '[Expert name]', role: 'Senior Data Analyst', years: '5 yrs hiring analysts', domains: ['Data & analytics', 'Finance'], rating: '4.9', placeholder: true },
  { initials: 'SE', name: '[Expert name]', role: 'SDE-2 · interview coach', years: '4 yrs on hiring panels', domains: ['Software engineering'], rating: '4.8', placeholder: true },
  { initials: 'HR', name: '[Expert name]', role: 'HR Business Partner', years: '8 yrs, 400+ fresher hires', domains: ['HR', 'BFSI', 'Operations'], rating: '4.9', placeholder: true },
  { initials: 'PM', name: '[Expert name]', role: 'Product Manager', years: '6 yrs, product & design hiring', domains: ['Product', 'Design'], rating: '4.7', placeholder: true },
];

// Leave a link empty to hide that icon.
export const SOCIAL = { linkedin: '', instagram: '', youtube: '', x: '' };
export const SISTER_SITE = { name: 'asuraa.ai', url: 'https://asuraa.ai', blurb: 'Learn from creators and mentors' };

export const showPlaceholders = import.meta.env.VITE_PREVIEW === '1' || import.meta.env.DEV;
export const visible = (list) => list.filter((x) => !x.placeholder || showPlaceholders);
