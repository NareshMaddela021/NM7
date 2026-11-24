// Oracle Taleo (*.taleo.net): a classic page-by-page flow (Personal Information, Experience, Education, Questions,
// eSignature) where each page is a full page load and "Save and Continue" moves on. Field ids are long generated
// strings that end in the data dictionary name ("…dv_cs_candidate_personal_info_FirstName"); work and education are
// numbered blocks ("…-dv_cs_experience_Employer-2" inside .editablesection-experience). The helper remembers the kit
// for the tab, so the candidate taps "Fill this step" after each page.
globalThis.Nm7Adapters.register({
  name: 'taleo',
  label: 'Taleo',
  hosts: [/(^|\.)taleo\.net$/],
  signature: '[id*="dv_cs_candidate"], #requisitionDescriptionInterface, .taleo-form',
  login: '#dialogTemplate-dialogForm-login-name1, [id$="login-password"], #loginForm',
  step: '.titlepage, #et-ef-content-ftf-flowTitle, h1.flowTitle',
  fields: [
    ['id', /dv_cs_candidate_personal_info_FirstName$/, 'first_name'],
    ['id', /dv_cs_candidate_personal_info_LastName$/, 'last_name'],
    ['id', /dv_cs_candidate_personal_info_EmailAddress$/, 'email'],
    ['id', /dv_cs_candidate_personal_info_(MobilePhone|HomePhone|CellularPhone)$/, 'phone'],
    ['id', /dv_cs_candidate_personal_info_City$/, 'city'],
    ['id', /dv_cs_candidate_personal_info_(WebSite|LinkedIn)$/i, 'linkedin'],
    ['id', /attachmentUploadInput|AttachedFilesBlock.*file$/i, 'resume'],
  ],
  sections: {
    work: '.editablesection-experience, [id*="dv_cs_experience_block"]',
    education: '.editablesection-education, [id*="dv_cs_education_block"]',
  },
  sectionFields: {
    work: [
      ['id', /dv_cs_experience_Employer(-\d+)?$/, 'company'], ['id', /dv_cs_experience_JobFunction(-\d+)?$/, 'title'],
      ['id', /dv_cs_experience_BeginDate(-\d+)?$/, 'from'], ['id', /dv_cs_experience_EndDate(-\d+)?$/, 'to'],
      ['id', /dv_cs_experience_CurrentEmployer(-\d+)?$/, 'current'],
    ],
    education: [
      ['id', /dv_cs_education_Institution(-\d+)?$/, 'school'], ['id', /dv_cs_education_Program(-\d+)?$/, 'degree'],
      ['id', /dv_cs_education_GraduationDate(-\d+)?$/, 'to'],
    ],
  },
  combobox: '',
  options: '[role="option"]',
});
