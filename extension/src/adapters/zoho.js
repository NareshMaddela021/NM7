// Zoho Recruit (career sites on zohorecruit.com / .in / .eu): the apply form uses the field's API name as id and
// name ("First_Name", "Mobile", "Current_Employer"); work and education are subform rows (Experience_Details and
// Educational_Details, "…_<field>_<row>"); some forms are embedded in an iframe on the company's own site.
globalThis.Nm7Adapters.register({
  name: 'zoho',
  label: 'Zoho Recruit',
  hosts: [/(^|\.)zohorecruit\.(com|in|eu|com\.au|com\.cn|jp)$/],
  signature: '#zr_apply_form, .zrsite-apply, input#First_Name[name="First_Name"]',
  login: '#signin_submit, .zr-login',
  step: '.zr-step.current .zr-step-title',
  fields: [
    ['id', /^First_Name$/, 'first_name'], ['id', /^Last_Name$/, 'last_name'], ['id', /^Email$/, 'email'],
    ['id', /^(Mobile|Phone)$/, 'phone'], ['id', /^City$/, 'city'], ['id', /^LinkedIn(__s)?$/i, 'linkedin'],
    ['id', /^Current_Employer$/, 'current_company'], ['id', /^Current_Job_Title$/, 'current_title'],
    ['id', /^Expected_Salary$/, 'salary'], ['id', /^Notice_Period$/, 'notice'],
    ['id', /^Highest_Qualification_Held$/, 'degree'], ['id', /^(Resume|resume_file)$/i, 'resume'],
  ],
  sections: {
    work: '[data-subform="Experience_Details"] .zr-subform-row, .zr-subform-row[data-subform="Experience_Details"]',
    education: '[data-subform="Educational_Details"] .zr-subform-row, .zr-subform-row[data-subform="Educational_Details"]',
  },
  sectionFields: {
    work: [
      ['name', /^Experience_Details_Company_\d+$/, 'company'], ['name', /^Experience_Details_Occupation_Title_\d+$/, 'title'],
      ['name', /^Experience_Details_Work_Duration_From_\d+$/, 'from'], ['name', /^Experience_Details_Work_Duration_To_\d+$/, 'to'],
      ['name', /^Experience_Details_I_currently_work_here_\d+$/, 'current'],
      ['name', /^Experience_Details_Summary_\d+$/, 'description'],
    ],
    education: [
      ['name', /^Educational_Details_Institute_School_\d+$/, 'school'], ['name', /^Educational_Details_Degree_\d+$/, 'degree'],
      ['name', /^Educational_Details_Major_Department_\d+$/, 'field'],
      ['name', /^Educational_Details_Duration_To_\d+$/, 'to'],
    ],
  },
  combobox: '[role="combobox"]',
  options: '[role="option"]',
});
