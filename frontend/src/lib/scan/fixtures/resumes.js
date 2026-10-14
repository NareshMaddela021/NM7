// Plain-text resumes for the analyzer tests. Each line becomes one { text } line, like the PDF/DOCX readers give.
const toLines = (s) => s.trim().split('\n').map((text) => ({ text: text.trim() })).filter((l) => l.text);

export const GOOD_DATA_ANALYST = toLines(`
Asha Kumar
Bengaluru · asha.kumar@gmail.com · +91 98450 12345 · linkedin.com/in/asha-kumar
Summary
Data analyst fresher with a 6-month analytics internship. Skilled in SQL, Python (Pandas), Excel and Power BI; built dashboards used by 40 managers.
Skills
SQL, Python, Pandas, Excel, Pivot tables, Power BI, Tableau, Statistics, A/B testing, Data cleaning, Data visualisation
Experience
Data Analyst Intern · Flipkart · Jan 2025 – Jun 2025
• Built 6 Power BI dashboards that cut weekly sales reporting from 5 hours to 30 minutes.
• Wrote 40+ SQL queries to clean and merge order data for 1.2 million rows.
• Ran an A/B test on the checkout page across 12,000 sessions; variant B lifted conversions by 9%.
Projects
• Analysed 3 years of Bengaluru rainfall data in Python and presented 5 findings to 60 students.
• Automated a monthly Excel report with pivot tables, saving the department 4 hours each month.
Education
B.Tech, Computer Science · RV College of Engineering · 2025 · 8.4 CGPA
Certifications
Google Data Analytics Certificate · Aug 2024
Achievements
• Ranked 3rd of 120 teams in the college data hackathon (Feb 2024).
• Led a team of 4 to build a placement-statistics dashboard used by 300 students.
• Mentored 15 juniors in SQL basics over 8 weekly sessions.
Languages
English, Kannada, Hindi
`);

export const WEAK = toLines(`
Ravi Shankar
Chennai · ravi.s@gmail.com
Career Objective
Seeking a challenging role in a reputed organisation where I can grow my skills and contribute to its growth.
Experience
Intern · ABC Traders · June 2024 – 08/2024
• Responsible for making reports in Excel.
• Helped with data entry for the sales team.
• Worked on customer records.
Education
B.Com · XYZ College · 2024
Personal Details
Date of Birth: 12/05/2003
Father's Name: S. Kumar
Marital Status: Single
Declaration
I hereby declare that the above information is true.
`);

export const GOOD_SOFTWARE = toLines(`
Karthik Reddy
Hyderabad · karthik.reddy@outlook.com · +91 91234 56789 · linkedin.com/in/karthikreddy · github.com/karthikr
Summary
Software engineer fresher who ships full-stack web apps in React and Node.js; 2 internships and 500+ DSA problems solved.
Technical Skills
Java, Python, JavaScript, React, Node.js, SQL, Git, REST APIs, Data structures, Algorithms, OOP, Linux, AWS, Unit testing
Experience
Software Engineering Intern · Zoho · May 2024 – Jul 2024
• Built a REST API in Node.js that serves 20,000 requests a day with 99.9% uptime.
• Cut page load time by 35% by moving 3 React screens to lazy loading.
• Wrote 120 unit tests, raising coverage from 40% to 78%.
Projects
• Built a placement portal in React and Node.js used by 1,500 students across 4 colleges.
• Solved 500+ data structures and algorithms problems on LeetCode (top 10% rating).
Education
B.Tech, Information Technology · JNTU Hyderabad · 2025 · 8.9 CGPA
Achievements
• Winner of the Smart India Hackathon 2023 (team of 6, 1 of 40 finalists).
`);
