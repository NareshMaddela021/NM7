// Keywords job posts commonly ask for, per common fresher role in India. Each entry: [label shown, pattern].
// Patterns are matched case-insensitively against the whole resume text, as whole words.
// Add a role: add a list + a trigger (regex on the role the user typed).

const L = (label, pattern = label.replace(/[.+*?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')) => [label, pattern];

export const ROLE_LISTS = {
  data: {
    name: 'Data Analyst',
    trigger: /data\s*(analyst|analytics|science|scientist|engineer)|\bmis\b|\bbi\b|analytics|reporting analyst/,
    keywords: [L('SQL'), L('Excel'), L('Python'), L('Power BI', 'power\\s*bi'), L('Tableau'), L('Statistics', 'statistic(s|al)'),
      L('Dashboards', 'dashboards?'), L('Data cleaning', 'data\\s*(cleaning|cleansing|wrangling)'), L('Data visualisation', 'data\\s*visuali[sz]ation'),
      L('Pandas'), L('A/B testing', 'a\\s*/\\s*b\\s*test(s|ing)?'), L('Pivot tables', 'pivot\\s*tables?'), L('Reporting', 'reports?|reporting')],
  },
  software: {
    name: 'Software Engineer',
    trigger: /software|developer|\bsde\b|programmer|full\s*stack|front\s*end|back\s*end|web\s*dev|engineer\s*trainee|\bswe\b|devops/,
    keywords: [L('Data structures', 'data\\s*structures?'), L('Algorithms', 'algorithms?'), L('Java'), L('Python'), L('C++', 'c\\+\\+'),
      L('JavaScript', 'javascript|\\bjs\\b'), L('React', 'react(\\.js|js)?'), L('Node.js', 'node(\\.js|js)?'), L('SQL'), L('Git'),
      L('REST APIs', 'rest(ful)?\\s*(apis?)?'), L('OOP', 'oops?|object[-\\s]oriented'), L('Testing', 'unit\\s*test(s|ing)?|testing'), L('Linux'),
      L('AWS / cloud', 'aws|azure|gcp|cloud')],
  },
  business: {
    name: 'Business Analyst',
    trigger: /business\s*analyst|\bba\b|product\s*analyst|business\s*analysis|functional\s*analyst/,
    keywords: [L('Requirements', 'requirements?|brd|frd'), L('Stakeholders', 'stakeholders?'), L('SQL'), L('Excel'), L('Power BI / Tableau', 'power\\s*bi|tableau'),
      L('Process mapping', 'process\\s*(mapping|flows?|improvement)'), L('User stories', 'user\\s*stor(y|ies)'), L('Agile', 'agile|scrum'), L('JIRA'),
      L('Data analysis', 'data\\s*analysis'), L('KPIs', 'kpis?'), L('Documentation', 'documentation|documented')],
  },
  marketing: {
    name: 'Marketing',
    trigger: /marketing|\bseo\b|social\s*media|content|brand|growth|digital/,
    keywords: [L('SEO'), L('Social media', 'social\\s*media'), L('Google Analytics', 'google\\s*analytics|\\bga4?\\b'), L('Content', 'content'),
      L('Campaigns', 'campaigns?'), L('Meta Ads', 'meta\\s*ads|facebook\\s*ads|instagram\\s*ads'), L('Google Ads', 'google\\s*ads|adwords|\\bsem\\b'),
      L('Email marketing', 'email\\s*marketing|newsletters?'), L('Branding', 'brand(ing)?'), L('Market research', 'market\\s*research'), L('Canva'),
      L('Copywriting', 'copywriting|copy\\s*writing'), L('CTR / conversions', 'ctr|conversions?|engagement\\s*rate')],
  },
  hr: {
    name: 'HR',
    trigger: /\bhr\b|human\s*resources?|recruit|talent|people\s*ops|payroll/,
    keywords: [L('Recruitment', 'recruit(ment|ing|ed)?'), L('Sourcing', 'sourcing'), L('Onboarding', 'onboarding'), L('Payroll'),
      L('Employee engagement', 'employee\\s*engagement'), L('HRMS / HRIS', 'hrms|hris'), L('Excel'), L('Interviewing', 'interview(s|ing)?'),
      L('Labour laws / compliance', 'labou?r\\s*laws?|compliance|pf|esi'), L('Training', 'training'), L('Performance management', 'performance\\s*(management|appraisal|review)s?')],
  },
  finance: {
    name: 'Finance',
    trigger: /financ|account|\bca\b|audit|banking|invest|tax|treasury|credit/,
    keywords: [L('Financial analysis', 'financial\\s*analysis'), L('Excel'), L('Tally'), L('GST'), L('Accounting', 'accounting|accounts'),
      L('Financial modelling', 'financial\\s*model(l)?ing'), L('Valuation', 'valuations?'), L('Budgeting', 'budget(s|ing)?'), L('Forecasting', 'forecast(s|ing)?'),
      L('Reconciliation', 'reconciliations?'), L('Taxation', 'tax(ation)?|tds'), L('Audit', 'audit(s|ing)?'), L('MIS')],
  },
  sales: {
    name: 'Sales',
    trigger: /sales|business\s*development|\bbde?\b|account\s*executive|inside\s*sales|key\s*account|pre-?sales/,
    keywords: [L('Lead generation', 'lead\\s*generation|leads'), L('CRM'), L('Negotiation', 'negotiat(ion|ed|ing)'), L('Clients', 'clients?|customers?'),
      L('Targets', 'targets?|quota'), L('Cold calling', 'cold\\s*call(s|ing)?'), L('Pipeline', 'pipeline'), L('B2B'), L('Revenue', 'revenue'),
      L('Salesforce / HubSpot', 'salesforce|hubspot|zoho\\s*crm'), L('Presentations', 'presentations?|pitch(es|ing)?')],
  },
};

// Used when the role matches none of the lists.
export const GENERAL = [L('Communication', 'communication'), L('Teamwork', 'team\\s*work|teamwork|collaborat(ed|ion)'), L('Problem solving', 'problem[-\\s]solving'),
  L('Excel'), L('Presentations', 'presentations?'), L('Leadership', 'leadership|led\\b')];

const GENERIC_ROLE_WORDS = new Set(['intern', 'internship', 'fresher', 'junior', 'jr', 'senior', 'sr', 'trainee', 'associate', 'executive', 'engineer', 'analyst',
  'manager', 'specialist', 'role', 'job', 'for', 'and', 'the', 'of', 'in', 'at', 'with', 'level', 'entry', 'graduate', 'i', 'ii', 'iii', 'a', 'an', 'to', 'officer',
  'assistant', 'lead', 'developer', 'consultant']);

/** Keywords to look for, for the role the user typed: the matching role lists plus the role's own words. */
export function keywordsFor(role) {
  const r = (role || '').toLowerCase();
  const lists = Object.values(ROLE_LISTS).filter((l) => l.trigger.test(r));
  const out = [];
  const seen = new Set();
  (lists.length ? lists.flatMap((l) => l.keywords) : GENERAL).forEach(([label, pattern]) => {
    if (!seen.has(label.toLowerCase())) { seen.add(label.toLowerCase()); out.push([label, pattern]); }
  });
  // A role we have no list for, e.g. "Supply Chain Analyst" → look for "supply chain" too
  const words = r.replace(/[^a-z0-9+#.\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !GENERIC_ROLE_WORDS.has(w));
  if (words.length && !lists.length) { // a known role's list already covers its own words ("data" in Data Analyst)
    const phrase = words.join(' ');
    const covered = out.some(([label, pattern]) => label.toLowerCase() === phrase || new RegExp(`^(?:${pattern})$`, 'i').test(phrase));
    if (!covered) out.unshift([words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' '), words.map((w) => w.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]*')]);
  }
  return { keywords: out, lists: lists.map((l) => l.name) };
}

export function findKeywords(text, keywords) {
  const found = [];
  const missing = [];
  keywords.forEach(([label, pattern]) => {
    const re = new RegExp(`(?<![a-z0-9])(?:${pattern})(?![a-z0-9])`, 'i');
    (re.test(text) ? found : missing).push(label);
  });
  return { found, missing };
}
