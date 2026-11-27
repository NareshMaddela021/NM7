// Darwinbox (*.darwinbox.in / .com career pages): an Angular app. Controls carry formcontrolname ("first_name",
// "mobile_no" …) inside db-form-field wrappers; the apply form is steps (Basic details, Work experience, Education,
// Additional questions) on one page; location and college are type-to-search lists (role="option" items in an
// overlay); work and education are repeating db-repeat-block blocks.
globalThis.Nm7Adapters.register({
  name: 'darwinbox',
  label: 'Darwinbox',
  hosts: [/(^|\.)darwinbox\.(in|com|io)$/],
  signature: 'db-form-field, .db-career-apply, [data-db-form]',
  login: '.db-login, [formcontrolname="password"]',
  step: '.db-stepper .active .db-step-title, .db-step-heading',
  fields: [
    ['fcn', /^first_?name$/i, 'first_name'], ['fcn', /^last_?name$/i, 'last_name'], ['fcn', /^(email|email_id)$/i, 'email'],
    ['fcn', /^(mobile|mobile_no|phone)$/i, 'phone'], ['fcn', /^(current_location|city)$/i, 'city'],
    ['fcn', /^linkedin(_url)?$/i, 'linkedin'], ['fcn', /^notice_period$/i, 'notice'],
    ['fcn', /^(expected_ctc|expected_salary)$/i, 'salary'], ['fcn', /^resume$/i, 'resume'],
  ],
  sections: {
    work: '[data-block="experience"], db-repeat-block.experience',
    education: '[data-block="education"], db-repeat-block.education',
  },
  sectionFields: {
    work: [
      ['fcn', /^(company|company_name|employer)$/i, 'company'], ['fcn', /^(designation|job_title)$/i, 'title'],
      ['fcn', /^(from|start_date)$/i, 'from'], ['fcn', /^(to|end_date)$/i, 'to'], ['fcn', /^currently_working$/i, 'current'],
    ],
    education: [
      ['fcn', /^(college|institute|university)$/i, 'school'], ['fcn', /^(degree|qualification)$/i, 'degree'],
      ['fcn', /^(specialization|branch)$/i, 'field'], ['fcn', /^(passing_year|year_of_passing)$/i, 'to'],
      ['fcn', /^(percentage|cgpa)$/i, 'grade'],
    ],
  },
  combobox: '[role="combobox"], .db-autocomplete input',
  options: '.db-option, [role="option"]',
});
