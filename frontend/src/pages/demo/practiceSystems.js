// The multi-step practice forms for the Nm7 Apply helper (/demo/apply/:slug, PracticeSystem.jsx). Each one copies
// only the STRUCTURE of a kind of hiring system's apply form (its step pages, the attributes its fields carry, its
// type-to-search lists, its repeating work and education blocks, one inside a frame) so the helper's adapters
// (extension/src/adapters/*.js) can be tried and tested on them. No real brand names, logos or look-alike styling:
// made-up companies, plain Nm7 practice styling. Next and Submit only move between steps and say "Practice form:
// nothing was sent." (no request of any kind). frontend/scripts/extension-helper.test.mjs fills every form with the
// review account's kit and fails the build when any form drops under 90% of its fields filled.
//
// A field: { t: type, l: label, a: attributes, k: the kit value it should get (for the release-gate test), o: options }
// t: text | email | tel | url | textarea | select | radio | checkbox | date | month | combo | file
// k: a kit field key, "work.<key>" / "edu.<key>" for the first work / education entry, "answer" (a ready answer),
// "ask" (a question the kit doesn't answer: a smart-answer draft), "personal" (a sensitive question, always left),
// "consent" (a declaration, always left).

export const CITIES = ['Pune', 'Pune Cantonment', 'Mumbai', 'Hyderabad', 'Bengaluru', 'Chennai', 'Delhi', 'Kolkata'];
export const COLLEGES = ['Demo College of Commerce (demo)', 'Demo Institute of Technology (demo)', 'Sample University of Arts (demo)', 'Demo Business School (demo)'];
const DEGREES = ['Select one', 'Bachelor of Commerce (B.Com)', 'Bachelor of Technology (B.Tech)', 'Bachelor of Science (B.Sc)', 'Bachelor of Arts (B.A)', 'Master of Business Administration (MBA)', 'Other'];
const NOTICE = ['Select one', 'Immediately', '15 days', '30 days', '60 days', '90 days'];
const YEARS = ['Year', '2020', '2021', '2022', '2023', '2024', '2025', '2026'];
const GENDER = ['Select one', 'Female', 'Male', 'Prefer not to say'];
const ASK = 'Describe a time you solved a difficult problem for a customer.';

const f = (t, l, a = {}, k = '', o) => ({ t, l, a, k, o });

export const SYSTEMS = {
  // a cloud HR suite: data-automation-id on everything, steps, month / year date parts, type-to-search school
  'cloud-portal': {
    company: 'Nimbus Freight (demo)', title: 'Operations Trainee', place: 'Pune · Full time',
    root: { 'data-automation-id': 'applyFlowPage' }, headAttr: { 'data-automation-id': 'pageHeaderTitle' },
    steps: [
      { title: 'My Information', fields: [
        f('text', 'First Name', { 'data-automation-id': 'legalNameSection_firstName' }, 'first_name'),
        f('text', 'Last Name', { 'data-automation-id': 'legalNameSection_lastName' }, 'last_name'),
        f('email', 'Email Address', { 'data-automation-id': 'email' }, 'email'),
        f('tel', 'Phone Number', { 'data-automation-id': 'phone-number' }, 'phone'),
        f('text', 'City', { 'data-automation-id': 'addressSection_city' }, 'city'),
        f('url', 'LinkedIn', { 'data-automation-id': 'linkedinQuestion' }, 'linkedin'),
      ] },
      { title: 'My Experience', blocks: [
        { kind: 'work', head: 'Work Experience', attrs: (i) => ({ 'data-automation-id': `workExperience-${i + 1}` }), fields: [
          f('text', 'Job Title', { 'data-automation-id': 'jobTitle' }, 'work.title'),
          f('text', 'Company', { 'data-automation-id': 'company' }, 'work.company'),
          f('checkbox', 'I currently work here', { 'data-automation-id': 'currentlyWorkHere' }, ''),
          f('text', 'Month', { 'data-automation-id': 'dateSectionMonth-input', wrap: 'formField-startDate', group: 'From' }, 'work.from_month'),
          f('text', 'Year', { 'data-automation-id': 'dateSectionYear-input', wrap: 'formField-startDate', group: 'From' }, 'work.from_year'),
          f('text', 'Month', { 'data-automation-id': 'dateSectionMonth-input', wrap: 'formField-endDate', group: 'To' }, 'work.to_month'),
          f('text', 'Year', { 'data-automation-id': 'dateSectionYear-input', wrap: 'formField-endDate', group: 'To' }, 'work.to_year'),
          f('textarea', 'Role Description', { 'data-automation-id': 'description' }, 'work.description'),
        ] },
        { kind: 'education', head: 'Education', attrs: (i) => ({ 'data-automation-id': `education-${i + 1}` }), fields: [
          f('combo', 'School or University', { 'data-automation-id': 'school', list: 'colleges' }, 'edu.school'),
          f('select', 'Degree', { 'data-automation-id': 'degree' }, 'edu.degree', DEGREES),
          f('text', 'Field of Study', { 'data-automation-id': 'fieldOfStudy' }, 'edu.field'),
          f('text', 'Year', { 'data-automation-id': 'dateSectionYear-input', wrap: 'formField-firstYearAttended', group: 'From' }, 'edu.from_year'),
          f('text', 'Year', { 'data-automation-id': 'dateSectionYear-input', wrap: 'formField-lastYearAttended', group: 'To' }, 'edu.to_year'),
        ] },
      ], fields: [f('file', 'Resume/CV', { 'data-automation-id': 'file-upload-input-ref' }, 'resume')] },
      { title: 'Application Questions', fields: [
        f('radio', 'What is your notice period?', { name: 'noticePeriod' }, 'notice', ['Immediately', '15 days', '30 days', '60 days']),
        f('textarea', 'Why do you want this role at Nimbus Freight?', { 'data-automation-id': 'whyRole' }, 'answer'),
        f('textarea', ASK, { 'data-automation-id': 'customerStory' }, 'ask'),
      ] },
      { title: 'Voluntary Disclosures', fields: [
        f('select', 'Gender', { 'data-automation-id': 'gender' }, 'personal', GENDER),
        f('date', 'Date of birth', { 'data-automation-id': 'dateOfBirth' }, 'personal'),
        f('checkbox', 'I agree to the terms and confirm my answers are true', { 'data-automation-id': 'agreementCheckbox' }, 'consent'),
      ] },
    ],
  },

  // an enterprise suite: "--name-inner" ids on every input, a profile with employment and
  // education blocks, then questions
  'suite-portal': {
    company: 'Coral Bank Services (demo)', title: 'Customer Care Associate', place: 'Hyderabad · Full time',
    root: { id: 'rcmCandidateProfile' }, headAttr: { className: 'rcmStepTitle' },
    steps: [
      { title: 'Candidate Profile', fields: [
        f('text', 'First Name', { id: 'rcmCandidateProfile--firstName-inner' }, 'first_name'),
        f('text', 'Last Name', { id: 'rcmCandidateProfile--lastName-inner' }, 'last_name'),
        f('email', 'Email', { id: 'rcmCandidateProfile--contactEmail-inner' }, 'email'),
        f('tel', 'Cell Phone', { id: 'rcmCandidateProfile--cellPhone-inner' }, 'phone'),
        f('combo', 'City', { id: 'rcmCandidateProfile--city-inner', list: 'cities' }, 'city'),
      ], blocks: [
        { kind: 'work', head: 'Previous Employment', attrs: (i) => ({ id: `rcmCandidateProfile--outsideWorkExperience-${i}` }), fields: [
          f('text', 'Employer', { id: (i) => `rcmCandidateProfile--outsideWorkExperience-${i}--employer-inner` }, 'work.company'),
          f('text', 'Job Title', { id: (i) => `rcmCandidateProfile--outsideWorkExperience-${i}--jobTitle-inner` }, 'work.title'),
          f('text', 'Start Date', { id: (i) => `rcmCandidateProfile--outsideWorkExperience-${i}--startDate-inner`, placeholder: 'MM/YYYY' }, 'work.from'),
          f('text', 'End Date', { id: (i) => `rcmCandidateProfile--outsideWorkExperience-${i}--endDate-inner`, placeholder: 'MM/YYYY' }, 'work.to'),
        ] },
        { kind: 'education', head: 'Education', attrs: (i) => ({ id: `rcmCandidateProfile--education-${i}` }), fields: [
          f('text', 'School', { id: (i) => `rcmCandidateProfile--education-${i}--school-inner` }, 'edu.school'),
          f('select', 'Degree', { id: (i) => `rcmCandidateProfile--education-${i}--degree` }, 'edu.degree', DEGREES),
          f('text', 'Major', { id: (i) => `rcmCandidateProfile--education-${i}--major-inner` }, 'edu.field'),
        ] },
      ] },
      { title: 'Application', fields: [
        f('select', 'Notice period', { id: 'rcmApplication--noticePeriod' }, 'notice', NOTICE),
        f('textarea', 'Cover Letter', { id: 'rcmCandidateProfile--coverLetter-inner' }, 'cover'),
        f('file', 'Resume', { id: 'rcmCandidateProfile--resumeUpload-input' }, 'resume'),
        f('textarea', ASK, { id: 'rcmApplication--question1-inner' }, 'ask'),
        f('date', 'Date of Birth', { id: 'rcmCandidateProfile--dateOfBirth-inner' }, 'personal'),
      ] },
    ],
  },

  // a classic page-by-page system: long generated ids ending in the data dictionary name, numbered blocks
  'classic-portal': {
    company: 'Harbor Foods (demo)', title: 'Store Supervisor Trainee', place: 'Mumbai · Full time',
    root: {}, headAttr: { className: 'titlepage' },
    steps: [
      { title: 'Personal Information', fields: [
        f('text', 'First Name', { id: 'et-ef-content-ftf-gp-j_id_id16pc9-page_0-cpi-cfrmsub-frm-dv_cs_candidate_personal_info_FirstName' }, 'first_name'),
        f('text', 'Last Name', { id: 'et-ef-content-ftf-gp-j_id_id16pc9-page_0-cpi-cfrmsub-frm-dv_cs_candidate_personal_info_LastName' }, 'last_name'),
        f('email', 'Email Address', { id: 'et-ef-content-ftf-gp-j_id_id16pc9-page_0-cpi-cfrmsub-frm-dv_cs_candidate_personal_info_EmailAddress' }, 'email'),
        f('tel', 'Mobile Phone', { id: 'et-ef-content-ftf-gp-j_id_id16pc9-page_0-cpi-cfrmsub-frm-dv_cs_candidate_personal_info_MobilePhone' }, 'phone'),
        f('text', 'City', { id: 'et-ef-content-ftf-gp-j_id_id16pc9-page_0-cpi-cfrmsub-frm-dv_cs_candidate_personal_info_City' }, 'city'),
      ] },
      { title: 'Experience and Education', blocks: [
        { kind: 'work', head: 'Work Experience', attrs: (i) => ({ className: 'editablesection-experience', 'data-row': i + 1 }), fields: [
          f('text', 'Employer', { id: (i) => `et-ef-content-ftf-gp-j_id_id16pc9-page_1-dv_cs_experience_Employer-${i + 1}` }, 'work.company'),
          f('text', 'Job Function', { id: (i) => `et-ef-content-ftf-gp-j_id_id16pc9-page_1-dv_cs_experience_JobFunction-${i + 1}` }, 'work.title'),
          f('text', 'Start Date', { id: (i) => `et-ef-content-ftf-gp-j_id_id16pc9-page_1-dv_cs_experience_BeginDate-${i + 1}`, placeholder: 'DD/MM/YYYY' }, 'work.from'),
          f('text', 'End Date', { id: (i) => `et-ef-content-ftf-gp-j_id_id16pc9-page_1-dv_cs_experience_EndDate-${i + 1}`, placeholder: 'DD/MM/YYYY' }, 'work.to'),
        ] },
        { kind: 'education', head: 'Education', attrs: (i) => ({ className: 'editablesection-education', 'data-row': i + 1 }), fields: [
          f('text', 'Institution', { id: (i) => `et-ef-content-ftf-gp-j_id_id16pc9-page_1-dv_cs_education_Institution-${i + 1}` }, 'edu.school'),
          f('text', 'Program', { id: (i) => `et-ef-content-ftf-gp-j_id_id16pc9-page_1-dv_cs_education_Program-${i + 1}` }, 'edu.degree'),
          f('text', 'Graduation Date', { id: (i) => `et-ef-content-ftf-gp-j_id_id16pc9-page_1-dv_cs_education_GraduationDate-${i + 1}`, placeholder: 'MM/YYYY' }, 'edu.to'),
        ] },
      ] },
      { title: 'Questions and Signature', fields: [
        f('select', 'Notice period', { id: 'et-ef-content-ftf-gp-j_id_id16pc9-page_2-qs-notice' }, 'notice', NOTICE),
        f('file', 'Attach your resume', { id: 'et-ef-content-ftf-gp-j_id_id16pc9-page_2-attachmentUploadInput' }, 'resume'),
        f('checkbox', 'I certify that the information is true and correct', { id: 'et-ef-content-ftf-gp-j_id_id16pc9-page_2-esign' }, 'consent'),
      ] },
    ],
  },

  // a system shown inside a frame on the company's careers page: PersonProfileFields.* names, table rows
  'framed-portal': {
    company: 'Lotus Health (demo)', title: 'Patient Support Executive', place: 'Chennai · Full time',
    framed: true, root: {}, headAttr: {},
    steps: [
      { title: 'Your Profile', fields: [
        f('text', 'First Name', { name: 'PersonProfileFields.FirstName' }, 'first_name'),
        f('text', 'Last Name', { name: 'PersonProfileFields.LastName' }, 'last_name'),
        f('email', 'Email', { name: 'PersonProfileFields.Email' }, 'email'),
        f('tel', 'Phone Number', { name: 'PersonProfileFields.PhoneNumber' }, 'phone'),
        f('text', 'City', { name: 'PersonProfileFields.City' }, 'city'),
        f('url', 'LinkedIn Profile', { name: 'PersonProfileFields.LinkedInURL' }, 'linkedin'),
        f('file', 'Resume', { name: 'PersonProfileFields.ResumeFile' }, 'resume'),
      ] },
      { title: 'Experience', blocks: [
        { kind: 'work', head: 'Work Experience', attrs: () => ({ 'data-table': 'WorkExperience' }), fields: [
          f('text', 'Employer', { name: (i) => `WorkExperience.${i}.Employer` }, 'work.company'),
          f('text', 'Title', { name: (i) => `WorkExperience.${i}.Title` }, 'work.title'),
          f('month', 'Start Date', { name: (i) => `WorkExperience.${i}.StartDate` }, 'work.from'),
          f('month', 'End Date', { name: (i) => `WorkExperience.${i}.EndDate` }, 'work.to'),
        ] },
        { kind: 'education', head: 'Education', attrs: () => ({ 'data-table': 'Education' }), fields: [
          f('text', 'School', { name: (i) => `Education.${i}.School` }, 'edu.school'),
          f('text', 'Degree', { name: (i) => `Education.${i}.Degree` }, 'edu.degree'),
          f('text', 'Major', { name: (i) => `Education.${i}.Major` }, 'edu.field'),
        ] },
      ], fields: [f('textarea', 'Cover Letter', { name: 'PersonProfileFields.CoverLetter' }, 'cover')] },
    ],
  },

  // an Indian HR suite: formcontrolname in snake_case, type-to-search city and college, native dates
  'people-portal': {
    company: 'Sapphire Retail (demo)', title: 'Retail Sales Associate', place: 'Bengaluru · Full time',
    root: { className: 'db-career-apply' }, headAttr: { className: 'db-step-heading' }, wrapTag: 'db-form-field',
    steps: [
      { title: 'Basic details', fields: [
        f('text', 'First name', { formcontrolname: 'first_name' }, 'first_name'),
        f('text', 'Last name', { formcontrolname: 'last_name' }, 'last_name'),
        f('email', 'Email ID', { formcontrolname: 'email_id' }, 'email'),
        f('tel', 'Mobile number', { formcontrolname: 'mobile_no' }, 'phone'),
        f('combo', 'Current location', { formcontrolname: 'current_location', list: 'cities' }, 'city'),
      ] },
      { title: 'Work experience and education', blocks: [
        { kind: 'work', head: 'Work experience', attrs: () => ({ 'data-block': 'experience' }), fields: [
          f('text', 'Company name', { formcontrolname: 'company_name' }, 'work.company'),
          f('text', 'Designation', { formcontrolname: 'designation' }, 'work.title'),
          f('date', 'Start date', { formcontrolname: 'start_date' }, 'work.from'),
          f('date', 'End date', { formcontrolname: 'end_date' }, 'work.to'),
        ] },
        { kind: 'education', head: 'Education', attrs: () => ({ 'data-block': 'education' }), fields: [
          f('combo', 'College', { formcontrolname: 'college', list: 'colleges' }, 'edu.school'),
          f('select', 'Degree', { formcontrolname: 'degree' }, 'edu.degree', DEGREES),
          f('text', 'Specialization', { formcontrolname: 'specialization' }, 'edu.field'),
          f('select', 'Year of passing', { formcontrolname: 'passing_year' }, 'edu.to_year', YEARS),
        ] },
      ] },
      { title: 'Additional questions', fields: [
        f('select', 'Notice period', { formcontrolname: 'notice_period' }, 'notice', NOTICE),
        f('file', 'Resume', { formcontrolname: 'resume' }, 'resume'),
        f('select', 'Marital status', { formcontrolname: 'marital_status' }, 'personal', ['Select one', 'Single', 'Married']),
      ] },
    ],
  },

  // an HR desk: one card with sections, formcontrolname in camelCase, month inputs
  'desk-portal': {
    company: 'Orbit Software (demo)', title: 'Junior Support Engineer', place: 'Pune · Full time',
    root: { className: 'kh-careers-apply' }, headAttr: { className: 'kh-step-title' },
    steps: [
      { title: 'Apply', fields: [
        f('text', 'First name', { formcontrolname: 'firstName' }, 'first_name'),
        f('text', 'Last name', { formcontrolname: 'lastName' }, 'last_name'),
        f('email', 'Email', { formcontrolname: 'email' }, 'email'),
        f('tel', 'Phone number', { formcontrolname: 'phoneNumber' }, 'phone'),
        f('combo', 'Current location', { formcontrolname: 'currentLocation', list: 'cities' }, 'city'),
        f('url', 'LinkedIn URL', { formcontrolname: 'linkedInUrl' }, 'linkedin'),
        f('select', 'Notice period', { formcontrolname: 'noticePeriod' }, 'notice', NOTICE),
      ], blocks: [
        { kind: 'work', head: 'Experience', attrs: () => ({ className: 'kh-experience-block' }), fields: [
          f('text', 'Company name', { formcontrolname: 'companyName' }, 'work.company'),
          f('text', 'Designation', { formcontrolname: 'designation' }, 'work.title'),
          f('month', 'From', { formcontrolname: 'fromDate' }, 'work.from'),
          f('month', 'To', { formcontrolname: 'toDate' }, 'work.to'),
        ] },
        { kind: 'education', head: 'Education', attrs: () => ({ className: 'kh-education-block' }), fields: [
          f('text', 'Institute', { formcontrolname: 'institute' }, 'edu.school'),
          f('text', 'Degree', { formcontrolname: 'degree' }, 'edu.degree'),
          f('text', 'Branch', { formcontrolname: 'branch' }, 'edu.field'),
          f('text', 'Year of passing', { formcontrolname: 'yearOfPassing', placeholder: 'YYYY' }, 'edu.to_year'),
        ] },
      ], after: [
        f('file', 'Resume', { formcontrolname: 'resume' }, 'resume'),
        f('textarea', 'Why do you want to join Orbit Software?', { formcontrolname: 'whyJoin' }, 'cover'),
      ] },
    ],
  },

  // a one-page job board form: ids first_name / candidate-location / school--0, a demographic question
  'quick-form': {
    company: 'Maple Learning (demo)', title: 'Academic Counsellor', place: 'Delhi · Full time',
    root: { id: 'application_form' }, headAttr: {},
    steps: [
      { title: 'Apply for this job', fields: [
        f('text', 'First Name', { id: 'first_name' }, 'first_name'),
        f('text', 'Last Name', { id: 'last_name' }, 'last_name'),
        f('email', 'Email', { id: 'email' }, 'email'),
        f('tel', 'Phone', { id: 'phone' }, 'phone'),
        f('combo', 'Location (City)', { id: 'candidate-location', list: 'cities' }, 'city'),
        f('file', 'Resume/CV', { id: 'resume' }, 'resume'),
        f('textarea', 'Cover Letter', { id: 'cover_letter_text' }, 'cover'),
        f('url', 'LinkedIn Profile', { id: 'question_101' }, 'linkedin'),
      ], blocks: [
        { kind: 'education', head: 'Education', attrs: (i) => ({ className: 'education--item', id: `education-${i}` }), fields: [
          f('combo', 'School', { id: (i) => `school--${i}`, list: 'colleges' }, 'edu.school'),
          f('select', 'Degree', { id: (i) => `degree--${i}` }, 'edu.degree', DEGREES),
          f('text', 'Discipline', { id: (i) => `discipline--${i}` }, 'edu.field'),
          f('select', 'End year', { id: (i) => `end-year--${i}` }, 'edu.to_year', YEARS),
        ] },
      ], after: [
        f('select', 'Gender (voluntary)', { id: 'demographic_gender' }, 'personal', GENDER),
      ] },
    ],
  },

  // a postings page: inputs named name / email / urls[LinkedIn] / comments, extra question cards
  'postings-form': {
    company: 'Quartz Media (demo)', title: 'Content Moderator', place: 'Kolkata · Full time',
    root: { className: 'application-page' }, headAttr: {}, questionCls: 'application-question',
    steps: [
      { title: 'Submit your application', fields: [
        f('file', 'Resume/CV', { name: 'resume' }, 'resume'),
        f('text', 'Full name', { name: 'name' }, 'full_name'),
        f('email', 'Email', { name: 'email' }, 'email'),
        f('tel', 'Phone', { name: 'phone' }, 'phone'),
        f('combo', 'Current location', { name: 'location', list: 'cities', id: 'location-input' }, 'city'),
        f('url', 'LinkedIn URL', { name: 'urls[LinkedIn]' }, 'linkedin'),
        f('textarea', 'Additional information', { name: 'comments' }, 'cover'),
        f('textarea', ASK, { name: 'cards[q1][field0]' }, 'ask'),
      ] },
    ],
  },

  // a recruiting suite's career site: API-name ids (First_Name, Mobile), subform rows
  'recruit-form': {
    company: 'Willow Travel (demo)', title: 'Travel Desk Executive', place: 'Hyderabad · Full time',
    root: { id: 'zr_apply_form' }, headAttr: {},
    steps: [
      { title: 'Apply', fields: [
        f('text', 'First Name', { id: 'First_Name', name: 'First_Name' }, 'first_name'),
        f('text', 'Last Name', { id: 'Last_Name', name: 'Last_Name' }, 'last_name'),
        f('email', 'Email', { id: 'Email', name: 'Email' }, 'email'),
        f('tel', 'Mobile', { id: 'Mobile', name: 'Mobile' }, 'phone'),
        f('text', 'City', { id: 'City', name: 'City' }, 'city'),
        f('url', 'LinkedIn', { id: 'LinkedIn__s', name: 'LinkedIn__s' }, 'linkedin'),
        f('select', 'Notice Period', { id: 'Notice_Period', name: 'Notice_Period' }, 'notice', NOTICE),
        f('select', 'Highest Qualification Held', { id: 'Highest_Qualification_Held', name: 'Highest_Qualification_Held' }, 'degree', DEGREES),
      ], blocks: [
        { kind: 'work', head: 'Experience Details', attrs: () => ({ className: 'zr-subform-row', 'data-subform': 'Experience_Details' }), fields: [
          f('text', 'Company', { name: (i) => `Experience_Details_Company_${i + 1}` }, 'work.company'),
          f('text', 'Occupation / Title', { name: (i) => `Experience_Details_Occupation_Title_${i + 1}` }, 'work.title'),
          f('text', 'Work Duration From', { name: (i) => `Experience_Details_Work_Duration_From_${i + 1}`, placeholder: 'MM/YYYY' }, 'work.from'),
          f('text', 'Work Duration To', { name: (i) => `Experience_Details_Work_Duration_To_${i + 1}`, placeholder: 'MM/YYYY' }, 'work.to'),
        ] },
        { kind: 'education', head: 'Educational Details', attrs: () => ({ className: 'zr-subform-row', 'data-subform': 'Educational_Details' }), fields: [
          f('text', 'Institute / School', { name: (i) => `Educational_Details_Institute_School_${i + 1}` }, 'edu.school'),
          f('text', 'Major / Department', { name: (i) => `Educational_Details_Major_Department_${i + 1}` }, 'edu.field'),
          f('text', 'Duration To', { name: (i) => `Educational_Details_Duration_To_${i + 1}`, placeholder: 'MM/YYYY' }, 'edu.to'),
        ] },
      ], after: [f('file', 'Resume', { id: 'Resume', name: 'Resume' }, 'resume')] },
    ],
  },
};

export const STEP_TEXT = (n, total) => `Practice step ${n} of ${total}: nothing was sent.`;
