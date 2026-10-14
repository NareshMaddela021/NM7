// Word lists the importers use to recognise sections and fields.
import { SKILL_GROUP_OF } from '../../pages/builder/schema';

const norm = (s) => s.toLowerCase().replace(/[^a-z& ]/g, ' ').replace(/\s+/g, ' ').trim();

// Section titles people actually use on Indian resumes → builder section id.
const HEADINGS = {
  summary: ['summary', 'profile', 'professional summary', 'profile summary', 'career summary', 'career objective', 'objective', 'about me', 'about', 'professional profile', 'personal summary', 'executive summary'],
  exp: ['experience', 'professional experience', 'work experience', 'employment history', 'employment', 'work history', 'internship', 'internships', 'experience & internships', 'internship experience', 'relevant experience', 'industrial experience', 'industry experience', 'career history'],
  edu: ['education', 'academics', 'academic', 'academic details', 'academic background', 'educational qualification', 'educational qualifications', 'qualification', 'qualifications', 'academic qualification', 'academic qualifications', 'education & qualifications', 'educational details', 'education details'],
  skills: ['skills', 'technical skills', 'key skills', 'core skills', 'core competencies', 'competencies', 'skills & tools', 'tools & technologies', 'technical proficiency', 'it skills', 'computer skills', 'skill set', 'skillset', 'expertise', 'areas of expertise', 'technologies', 'top skills', 'course & skills', 'courses & skills', 'skills & courses', 'software skills'],
  proj: ['projects', 'project', 'academic projects', 'personal projects', 'key projects', 'major project', 'mini project', 'projects undertaken', 'project details', 'project work'],
  certs: ['certifications', 'certification', 'certificates', 'courses & certifications', 'certifications & courses', 'licenses & certifications', 'trainings', 'training', 'courses', 'online courses', 'trainings & certifications'],
  ach: ['achievements', 'awards', 'honors', 'honours', 'honors awards', 'honors & awards', 'awards & achievements', 'achievements & awards', 'accomplishments', 'awards & recognition'],
  langs: ['languages', 'languages known', 'language', 'linguistic proficiency'],
  hobbies: ['hobbies', 'interests', 'hobbies & interests', 'interests & hobbies', 'personal interests'],
  strengths: ['strengths', 'key strengths', 'personal strengths', 'my strengths'],
  pinfo: ['personal information', 'personal details', 'personal profile', 'personal data', 'personal info'],
  decl: ['declaration'],
};
const HEAD_INDEX = {};
Object.entries(HEADINGS).forEach(([id, list]) => list.forEach((t) => { HEAD_INDEX[norm(t)] = id; }));

/** Returns a section id for a heading-like line, or null. */
export function headingId(text) {
  const t = norm(text.replace(/:$/, ''));
  if (!t || t.split(' ').length > 5) return null;
  return HEAD_INDEX[t] || HEAD_INDEX[t.replace(/ & /g, ' ')] || null;
}

/* ---------- skills ---------- */
const EXTRA_GROUP = {
  'ms excel': 'tools', 'advanced excel': 'tools', 'microsoft excel': 'tools', 'power bi': 'tools', powerbi: 'tools', jira: 'tools', 'jupyter': 'tools', 'jupyter notebook': 'tools', 'vs code': 'tools', linux: 'tools', sap: 'tools', 'google analytics': 'tools', 'looker': 'tools', 'ms office': 'tools', 'microsoft office': 'tools', 'autocad': 'tools', matlab: 'tools', 'github': 'tools', 'postman': 'tools', 'tally': 'tools', 'canva': 'tools', 'snowflake': 'tools', 'databricks': 'tools', 'airflow': 'tools',
  numpy: 'frameworks', pandas: 'frameworks', matplotlib: 'frameworks', seaborn: 'frameworks', tensorflow: 'frameworks', keras: 'frameworks', 'scikit learn': 'frameworks', sklearn: 'frameworks', flask: 'frameworks', 'spring boot': 'frameworks', angular: 'frameworks', 'vue': 'frameworks', 'express': 'frameworks', 'langchain': 'frameworks', 'hugging face': 'frameworks', 'opencv': 'frameworks', 'spark': 'frameworks', 'pyspark': 'frameworks', 'tailwind': 'frameworks', 'bootstrap': 'frameworks',
  mysql: 'core', 'sql server': 'core', 'c': 'core', 'c#': 'core', html: 'core', css: 'core', 'html css': 'core', r: 'core', 'deep learning': 'core', 'nlp': 'core', 'natural language processing': 'core', 'computer vision': 'core', 'artificial intelligence': 'core', 'artificial intelligence ai': 'core', ai: 'core', 'generative ai': 'core', 'genai': 'core', 'data visualization': 'core', 'data science': 'core', 'linear algebra': 'core', 'probability': 'core', 'data structures': 'core', 'dsa': 'core', 'kotlin': 'core', 'swift': 'core', 'php': 'core', 'rust': 'core', 'etl': 'core',
  teamwork: 'soft', 'team work': 'soft', 'team management': 'soft', 'time management': 'soft', 'critical thinking': 'soft', 'supply chain management': 'soft', 'inventory management': 'soft', 'project management': 'soft', negotiation: 'soft', 'customer service': 'soft', 'stakeholder management': 'soft', 'presentation': 'soft', 'analytical skills': 'soft',
};
const GROUP_LC = Object.fromEntries(Object.entries(SKILL_GROUP_OF).map(([k, v]) => [norm(k), v]));
export const skillGroupOf = (s) => GROUP_LC[norm(s)] || EXTRA_GROUP[norm(s)] || null;

/* ---------- languages ---------- */
export function langLevel(raw) {
  const t = (raw || '').toLowerCase();
  if (/native|bilingual|mother/.test(t)) return 'Native';
  if (/full professional|fluent|proficient|advanced/.test(t)) return 'Fluent';
  if (/professional|working|intermediate/.test(t)) return 'Professional';
  if (/elementary|limited|basic|beginner/.test(t)) return 'Basic';
  return '';
}

/* ---------- entries ---------- */
export const ROLE_RE = /\b(engineer|intern|internship|trainee|analyst|developer|manager|executive|associate|consultant|lead|designer|scientist|officer|founder|co-founder|ceo|cto|head|specialist|coordinator|assistant|administrator|architect|programmer|tester|accountant|representative|advisor|supervisor|technician|apprentice|fellow|volunteer|teacher|tutor|researcher|director|president|member|owner|freelancer)\b/i;
export const ORG_RE = /\b(pvt|private|ltd|limited|llp|inc|corp|corporation|company|technologies|technology|solutions|services|systems|labs|software|consulting|group|industries|india|global|bank|university|hospital|foundation|ventures|enterprises|infotech|tech|ai)\b/i;
export const DEGREE_RE = /\b(b\.?\s?tech|m\.?\s?tech|b\.?\s?e\b|m\.?\s?e\b|b\.?\s?sc|m\.?\s?sc|b\.?\s?com|m\.?\s?com|b\.?\s?a\b|m\.?\s?a\b|bba|mba|bca|mca|b\.?\s?pharm|m\.?\s?pharm|mbbs|ph\.?\s?d|diploma|bachelor|master|class\s*(x|xii|10|12)|10th|12th|ssc|hsc|intermediate|puc|higher secondary|secondary|matriculation|pg program|post graduate|pgdm|pgd|degree)\b/i;
export const SCHOOL_RE = /\b(institute|college|university|school|iit|nit|iiit|academy|polytechnic|vidyalaya|vidyalayam|board|cbse|icse|campus)\b/i;
export const GRADE_RE = /\b(cgpa|gpa|cpi|sgpa|percentage|marks|grade|aggregate)\b[\s:–-]*([\d.]+\s*(?:\/\s*\d+)?\s*%?)|([\d.]{2,5}\s*%)|([\d.]+\s*\/\s*10)\b/i;

/* ---------- contact ---------- */
export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
export const PHONE_RE = /(?:\+?91[\s-]*)?(?:\(?0?\)?[\s-]*)?[6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4}\b|\+\d{1,3}[\s-]?\d{3,5}[\s-]?\d{3,5}[\s-]?\d{0,5}/;
export const URL_RE = /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s,|()]*)?/gi;

/** Puts a URL into the builder's link slot. */
export function linkSlot(url, label = '') {
  const u = url.toLowerCase();
  if (u.includes('linkedin.com/in')) return 'linkedin';
  if (u.includes('github.com')) return 'github';
  if (/(?:twitter|x)\.com\//.test(u)) return 'twitter';
  if (u.includes('stackoverflow.com')) return 'stackoverflow';
  if (u.includes('medium.com') || /blog/i.test(label)) return 'medium';
  if (/drive\.google|dropbox/.test(u)) return 'resume';
  return 'portfolio';
}
/** Short, clean form for the builder: no https://, no tracking query. */
export function cleanUrl(url) {
  let u = url.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  if (/linkedin\.com\/in\//i.test(u) || /utm_|lipi=|licu=|jobid=/.test(u)) u = u.split('?')[0];
  return u.replace(/\/+$/, '');
}

export const INDIAN_PLACE_RE = /\b(andhra pradesh|telangana|karnataka|tamil nadu|kerala|maharashtra|delhi|new delhi|gujarat|rajasthan|uttar pradesh|west bengal|bihar|odisha|punjab|haryana|madhya pradesh|goa|assam|jharkhand|chhattisgarh|uttarakhand|himachal|bengaluru|bangalore|hyderabad|chennai|mumbai|pune|kolkata|noida|gurugram|gurgaon|india)\b/i;
