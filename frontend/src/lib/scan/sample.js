// The sample resume for "No resume handy? Try a sample". It goes through the same analyzer as a real file,
// and the report is always labelled "Sample resume".
export const SAMPLE_FILE = 'Sample resume — Sai Varsha';
export const SAMPLE_LINES = [
  'Sai Varsha',
  'Chennai · saivarsha@example.com · +91 98765 43210',
  'Objective',
  'Seeking a challenging role in a reputed organisation where I can grow my skills.',
  'Skills',
  { text: 'SKILLS | SQL | Python | Excel', table: true },
  'Experience',
  'Data Analyst Intern · Sample Analytics Pvt Ltd · Jan 2025 – Jun 2025',
  '• Helped with dashboards for the sales team.',
  '• Cleaned weekly CSV exports in Python.',
  'Projects',
  '• Analysed website data for a college project.',
  'Education',
  'B.Tech, Computer Science · Sample Engineering College · 2025 · 8.1 CGPA',
].map((l) => (typeof l === 'string' ? { text: l } : l));
