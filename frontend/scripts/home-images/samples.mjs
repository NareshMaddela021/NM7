// Sample people for the home page images (scripts/home-images/make.mjs draws them with the real templates and saves
// WebP files in public/home/). Everyone here is invented: no real people, no real ID numbers.

const skills = (core, tools = '', soft = '') => [
  { id: 'core', label: 'Core skills', value: core },
  { id: 'frameworks', label: 'Frameworks & Libraries', value: '' },
  { id: 'tools', label: 'Tools', value: tools },
  { id: 'soft', label: 'Soft skills', value: soft },
];
const none = { proj: [], certs: [], ach: [], links: {}, linkExtras: [] };

export const SAMPLES = {
  // ---------- hero: three people, three very different jobs ----------
  btech: {
    template: 'campus',
    data: {
      ...none,
      personal: { name: 'Ananya Reddy', headline: 'B.Tech CSE · Java · React · SQL', email: 'ananya.reddy@example.com', phone: '+91 90000 11111', location: 'Hyderabad, Telangana', level: 'Fresher (0–1 yr)' },
      summary: 'Final-year B.Tech (Computer Science) student who has built three full-stack projects with Java, React and MySQL. Led a 4-member team that shipped a hostel complaint app used by 600 students. Looking for a software developer role.',
      edu: [{ institution: 'Godavari Institute of Engineering, Hyderabad', degree: 'B.Tech', field: 'Computer Science', from: '2021-08', to: '2025-05', current: false, grade: '8.4 CGPA' },
        { institution: 'Sri Chaitanya Junior College', degree: 'Intermediate (MPC)', field: '', from: '2019-06', to: '2021-04', current: false, grade: '94%' }],
      proj: [{ title: 'Hostel Complaint Tracker', tagline: 'React + Spring Boot app for 600 hostel students', type: 'Academic / Research', status: 'Completed', from: '2024-07', to: '2024-11', ongoing: false, description: 'Cut average complaint closing time from 6 days to 2 days\nBuilt REST APIs in Spring Boot and a React dashboard for wardens', tech: 'React, Spring Boot, MySQL', links: [] },
        { title: 'Bus Pass Renewal Bot', tagline: 'Telegram bot for college bus passes', type: 'Personal', status: 'Completed', from: '2024-01', to: '2024-03', ongoing: false, description: 'Handled 1,200 renewals in its first month', tech: 'Python, SQLite', links: [] }],
      exp: [{ company: 'Bright Path Software, Hyderabad', role: 'Software Intern', employmentType: 'Internship', from: '2024-05', to: '2024-07', current: false, description: 'Wrote unit tests that raised coverage of the billing module from 40% to 75%\nFixed 18 reported bugs in the React front end' }],
      skillGroups: skills('Java, Python, SQL, JavaScript', 'React, Spring Boot, Git, MySQL', 'Team lead, Clear communication'),
      certs: [{ name: 'NPTEL — Data Structures and Algorithms (Elite)', issuer: 'NPTEL', issueDate: '2024-04', expiryDate: '', credentialId: '', noExpiry: true, links: [] }],
      langs: [{ name: 'English', level: 'Fluent' }, { name: 'Telugu', level: 'Native' }, { name: 'Hindi', level: 'Professional' }],
    },
  },
  delivery: {
    template: 'work',
    data: {
      ...none,
      personal: { name: 'Mohammed Irfan', headline: 'Delivery Partner · Two-wheeler licence · 4 years', email: 'irfan.delivery@example.com', phone: '+91 90000 22222', location: 'Bengaluru, Karnataka', level: '3–5 years' },
      summary: 'Delivery partner with 4 years on two-wheeler routes across south Bengaluru. Kept a 4.9 customer rating over 9,000 deliveries and never missed a shift in the last year. Looking for a delivery lead or warehouse supervisor job.',
      skillGroups: skills('Two-wheeler driving, Route planning, Cash handling, Customer service', 'Google Maps, Delivery partner apps, UPI', 'Punctual, Polite, Reliable'),
      exp: [{ company: 'QuickBasket Grocery Delivery', role: 'Delivery Partner', employmentType: 'Full-time', from: '2022-03', to: '', current: true, description: 'Delivered 25–30 orders a day in Jayanagar and BTM Layout\nKept a 4.9 / 5 rating over 9,000 deliveries\nTrained 6 new riders on routes and safe driving' },
        { company: 'CityLink Courier Services', role: 'Courier Rider', employmentType: 'Full-time', from: '2020-11', to: '2022-02', current: false, description: 'Picked up and delivered 40 parcels a day with zero lost parcels\nCollected cash on delivery and settled it daily' }],
      certs: [{ name: 'Driving licence — two-wheeler (Karnataka)', issuer: 'Transport Department', issueDate: '2019-08', expiryDate: '', credentialId: '', noExpiry: true, links: [] },
        { name: 'Road safety training', issuer: 'QuickBasket', issueDate: '2022-04', expiryDate: '', credentialId: '', noExpiry: true, links: [] }],
      langs: [{ name: 'Kannada', level: 'Fluent' }, { name: 'Urdu', level: 'Native' }, { name: 'Hindi', level: 'Fluent' }, { name: 'English', level: 'Basic' }],
      edu: [{ institution: 'Govt. PU College, Bengaluru', degree: 'PUC (Commerce)', field: '', from: '2016-06', to: '2018-04', current: false, grade: '' }],
    },
  },
  nurse: {
    template: 'care',
    data: {
      ...none,
      personal: { name: 'Lalitha Kumari', headline: 'Staff Nurse · ICU · 6 years', email: 'lalitha.nurse@example.com', phone: '+91 90000 33333', location: 'Kochi, Kerala', level: '5–10 years' },
      summary: 'Registered staff nurse with 6 years in medical ICU and emergency care. Cares for 4–6 critical patients a shift and trains new nurses on ventilator care. Looking for a senior staff nurse role in a multi-speciality hospital.',
      certs: [{ name: 'Registered Nurse and Midwife', issuer: 'Kerala Nurses and Midwives Council', issueDate: '2018-09', expiryDate: '', credentialId: '', noExpiry: true, links: [] },
        { name: 'Basic Life Support (BLS) and ACLS', issuer: 'Indian Resuscitation Council', issueDate: '2024-02', expiryDate: '2026-02', credentialId: '', noExpiry: false, links: [] }],
      exp: [{ company: 'Lakeshore Multi-speciality Hospital, Kochi', role: 'Staff Nurse — Medical ICU', employmentType: 'Full-time', from: '2020-07', to: '', current: true, description: 'Care for 4–6 critical patients a shift, including ventilator patients\nTrained 14 new nurses on ICU protocols\nCut medication errors on the unit to zero for 18 months with a double-check routine' },
        { company: 'St. Mary’s Hospital, Thrissur', role: 'Staff Nurse — Emergency', employmentType: 'Full-time', from: '2018-10', to: '2020-06', current: false, description: 'Triaged 60+ patients a day in a busy emergency department' }],
      edu: [{ institution: 'Government College of Nursing, Kottayam', degree: 'B.Sc Nursing', field: '', from: '2014-08', to: '2018-07', current: false, grade: 'First class' }],
      skillGroups: skills('Critical care, Ventilator care, IV therapy, Wound care, Patient education', 'Hospital information system (HIS), Infusion pumps', 'Calm under pressure, Teamwork'),
      langs: [{ name: 'Malayalam', level: 'Native' }, { name: 'English', level: 'Fluent' }, { name: 'Hindi', level: 'Professional' }],
    },
  },

  // ---------- "Resumes for every kind of job" ----------
  tech: {
    template: 'fresher',
    data: {
      ...none,
      personal: { name: 'Rahul Verma', headline: 'B.Tech IT · Python · Data Analysis', email: 'rahul.verma@example.com', phone: '+91 90000 44444', location: 'Indore, Madhya Pradesh', level: 'Fresher (0–1 yr)' },
      summary: 'B.Tech (Information Technology) graduate who analyses data with Python and SQL. Built a crop-price dashboard that 300 farmers in two districts now check weekly. Looking for a data analyst or junior developer role.',
      proj: [{ title: 'Mandi Price Dashboard', tagline: 'Daily crop prices for 12 mandis in Madhya Pradesh', type: 'Personal', status: 'Completed', from: '2024-06', to: '2024-09', ongoing: false, description: 'Collected 2 years of prices with Python and cleaned them in Pandas\nUsed weekly by about 300 farmers through a WhatsApp link', tech: 'Python, Pandas, Power BI', links: [] }],
      exp: [{ company: 'Narmada Analytics, Indore', role: 'Data Intern', employmentType: 'Internship', from: '2024-12', to: '2025-04', current: false, description: 'Automated a weekly sales report, saving the team 5 hours a week\nWrote 40 SQL queries for the finance dashboard' }],
      edu: [{ institution: 'Malwa Institute of Technology, Indore', degree: 'B.Tech', field: 'Information Technology', from: '2021-08', to: '2025-06', current: false, grade: '7.9 CGPA' }],
      skillGroups: skills('Python, SQL, Excel, Statistics', 'Pandas, Power BI, Git', 'Problem solving'),
      certs: [{ name: 'Data Analytics with Python', issuer: 'NPTEL', issueDate: '2024-10', expiryDate: '', credentialId: '', noExpiry: true, links: [] }],
      langs: [{ name: 'Hindi', level: 'Native' }, { name: 'English', level: 'Fluent' }],
    },
  },
  govt: {
    template: 'kio',
    data: {
      ...none,
      personal: { name: 'Priyanka Das', headline: 'B.Com · Accounts and office work', email: 'priyanka.das@example.com', phone: '+91 90000 55555', location: 'Bhubaneswar, Odisha', level: '1–3 years' },
      summary: 'Commerce graduate with 2 years of accounts and office work in a cooperative bank branch. Handles ledgers, Tally entries and customer queries with care. Applying for clerical and assistant posts in banks and PSUs.',
      edu: [{ institution: 'Utkal University, Bhubaneswar', degree: 'B.Com', field: 'Accounting', from: '2018-07', to: '2021-06', current: false, grade: '72%' },
        { institution: 'Council of Higher Secondary Education, Odisha', degree: 'Class XII (Commerce)', field: '', from: '2016-06', to: '2018-04', current: false, grade: '81%' }],
      exp: [{ company: 'Kalinga Cooperative Bank, Bhubaneswar', role: 'Office Assistant', employmentType: 'Full-time', from: '2022-01', to: '', current: true, description: 'Maintain daily cash and loan ledgers in Tally\nAnswer 30+ customer queries a day at the front desk' }],
      hobbies: 'Reading newspapers\nOdissi dance\nGardening',
      strengths: 'Careful with numbers\nPunctual\nPatient with customers',
      pinfo: { father: 'Sri Ramesh Das', mother: 'Smt. Gita Das', dob: '1999-11-02', gender: 'Female', marital: 'Unmarried', nationality: 'Indian', languages: 'Odia, Hindi, English', address: 'Bhubaneswar, Odisha' },
      decl: { text: 'I hereby declare that the information given above is true to the best of my knowledge and belief.', place: 'Bhubaneswar', date: '2025-06-01', name: 'Priyanka Das' },
      skillGroups: skills('Tally, MS Excel, Typing (40 wpm)', '', ''),
      langs: [{ name: 'Odia', level: 'Native' }, { name: 'Hindi', level: 'Fluent' }, { name: 'English', level: 'Fluent' }],
    },
  },
  sales: {
    template: 'impact',
    data: {
      ...none,
      personal: { name: 'Arjun Singh Rathore', headline: 'Field Sales Executive · FMCG · 5 years', email: 'arjun.rathore@example.com', phone: '+91 90000 66666', location: 'Jaipur, Rajasthan', level: '3–5 years' },
      summary: 'Field sales executive with 5 years in FMCG distribution across Jaipur and Ajmer. Grew my territory’s monthly sales by 38% and opened 120 new retail outlets. Looking for an area sales manager role.',
      exp: [{ company: 'Sunrise Foods Distributors, Jaipur', role: 'Field Sales Executive', employmentType: 'Full-time', from: '2021-04', to: '', current: true, description: 'Grew monthly territory sales from ₹18 lakh to ₹25 lakh (38%) in 2 years\nOpened 120 new retail outlets across 9 routes\nCut overdue payments by 45% with weekly collection visits' },
        { company: 'Marudhar Beverages', role: 'Sales Representative', employmentType: 'Full-time', from: '2019-07', to: '2021-03', current: false, description: 'Covered 140 shops a week; won the zone’s “Best Newcomer” award in 2020' }],
      edu: [{ institution: 'University of Rajasthan', degree: 'BBA', field: 'Marketing', from: '2016-07', to: '2019-05', current: false, grade: '' }],
      skillGroups: skills('Route planning, Retail negotiation, Distributor management, Collections', 'Salesforce mobile app, Excel, WhatsApp Business', 'Hindi and Marwari with retailers'),
      ach: [{ title: 'Best Newcomer — North Zone', type: 'Award', date: '2020-03', issuer: 'Marudhar Beverages', description: '' }],
      langs: [{ name: 'Hindi', level: 'Native' }, { name: 'English', level: 'Professional' }, { name: 'Marwari', level: 'Fluent' }],
    },
  },
  trades: {
    template: 'work',
    data: {
      ...none,
      personal: { name: 'Murugan Selvam', headline: 'Electrician · ITI · 8 years', email: 'murugan.electrician@example.com', phone: '+91 90000 77777', location: 'Coimbatore, Tamil Nadu', level: '5–10 years' },
      summary: 'ITI-trained electrician with 8 years of wiring, panel work and motor repair in textile mills and apartments. Led a 5-person crew that wired a 120-flat apartment block on time. Looking for a maintenance electrician or supervisor job.',
      skillGroups: skills('House and industrial wiring, Panel boards, Motor rewinding, Fault finding, Solar installation', 'Multimeter, Megger, Clamp meter', 'Safe working, Crew lead'),
      exp: [{ company: 'Kovai Textile Mills', role: 'Maintenance Electrician', employmentType: 'Full-time', from: '2019-02', to: '', current: true, description: 'Keep 210 looms and motors running across two shifts\nCut breakdown time by 30% with a weekly check routine' },
        { company: 'Sri Lakshmi Builders', role: 'Electrician (crew lead)', employmentType: 'Contract', from: '2016-06', to: '2019-01', current: false, description: 'Led a 5-person crew that wired a 120-flat apartment block on schedule' }],
      certs: [{ name: 'Wireman licence (B grade)', issuer: 'Electrical Licensing Board, Tamil Nadu', issueDate: '2016-03', expiryDate: '', credentialId: '', noExpiry: true, links: [] },
        { name: 'Rooftop solar installation', issuer: 'Skill India', issueDate: '2023-08', expiryDate: '', credentialId: '', noExpiry: true, links: [] }],
      edu: [{ institution: 'Govt. ITI, Coimbatore', degree: 'ITI — Electrician', field: '', from: '2014-08', to: '2016-07', current: false, grade: '' }],
      langs: [{ name: 'Tamil', level: 'Native' }, { name: 'English', level: 'Basic' }],
    },
  },
  returning: {
    template: 'classic',
    data: {
      ...none,
      personal: { name: 'Meenakshi Iyer', headline: 'Accountant · GST and payroll · returning after a career break', email: 'meenakshi.iyer@example.com', phone: '+91 90000 88888', location: 'Pune, Maharashtra', level: '5–10 years' },
      summary: 'Chartered-firm accountant with 6 years in GST filing, payroll and audits, returning after a 4-year career break to raise my children. Refreshed my skills with Tally Prime and GST courses in 2025. Looking for an accounts executive role.',
      exp: [{ company: 'Career break — family care', role: 'Planned career break', employmentType: '', from: '2021-04', to: '2025-03', current: false, description: 'Kept accounts for a residents’ welfare association of 80 flats (volunteer)\nCompleted Tally Prime and GST courses' },
        { company: 'Deshpande & Associates, Chartered Accountants', role: 'Senior Accounts Executive', employmentType: 'Full-time', from: '2015-06', to: '2021-03', current: false, description: 'Filed monthly GST returns for 25 clients without a single late fee\nRan payroll for 3 companies with 180 employees in total' }],
      edu: [{ institution: 'Savitribai Phule Pune University', degree: 'M.Com', field: 'Accounting and Taxation', from: '2013-07', to: '2015-05', current: false, grade: 'First class' }],
      skillGroups: skills('GST returns, Payroll, Bank reconciliation, Audit support', 'Tally Prime, MS Excel, Zoho Books', 'Careful, Organised'),
      certs: [{ name: 'GST practitioner course', issuer: 'ICAI (online)', issueDate: '2025-01', expiryDate: '', credentialId: '', noExpiry: true, links: [] }],
      langs: [{ name: 'Marathi', level: 'Fluent' }, { name: 'Tamil', level: 'Native' }, { name: 'English', level: 'Fluent' }, { name: 'Hindi', level: 'Fluent' }],
    },
  },
};

// image name → [sample, width in CSS px, max KB]
export const IMAGES = [
  ['hero-btech', 'btech', 340], ['hero-delivery', 'delivery', 340], ['hero-nurse', 'nurse', 340],
  ['role-tech', 'tech', 360], ['role-govt', 'govt', 360], ['role-care', 'nurse', 360],
  ['role-sales', 'sales', 360], ['role-trades', 'trades', 360], ['role-returning', 'returning', 360],
];
