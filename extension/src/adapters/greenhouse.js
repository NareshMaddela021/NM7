// Greenhouse (boards.greenhouse.io, job-boards.greenhouse.io, or embedded on the company's site in #grnhse_app): one
// long form, ids first_name / last_name / email / phone, location as a type-to-search list (candidate-location),
// custom questions question_<n>, and education rows school--0 / degree--0 / discipline--0 with start / end month and
// year (select or text).
globalThis.Nm7Adapters.register({
  name: 'greenhouse',
  label: 'Greenhouse',
  hosts: [/(^|\.)greenhouse\.io$/],
  signature: '#application_form, #grnhse_app, form#application-form[data-provides="greenhouse"]',
  login: '',
  step: '',
  frame: '#grnhse_iframe',
  fields: [
    ['id', /^first_name$/, 'first_name'], ['id', /^last_name$/, 'last_name'], ['id', /^email$/, 'email'],
    ['id', /^phone$/, 'phone'], ['name', /job_application\[first_name\]/, 'first_name'],
    ['name', /job_application\[last_name\]/, 'last_name'], ['name', /job_application\[email\]/, 'email'],
    ['name', /job_application\[phone\]/, 'phone'], ['name', /job_application\[location\]/, 'city'],
    ['id', /^candidate-location$/, 'city'], ['id', /^cover_letter_text$/, 'cover'],
    ['id', /^resume$/, 'resume'], ['name', /job_application\[resume\]/, 'resume'],
  ],
  sections: {
    work: '.employment--item, [id^="employment-"]',
    education: '.education--item, [id^="education-"]',
  },
  sectionFields: {
    work: [
      ['id', /^company-name--\d+$/, 'company'], ['id', /^title--\d+$/, 'title'],
      ['id', /^start-date-month--\d+$/, 'from_month'], ['id', /^start-date-year--\d+$/, 'from_year'],
      ['id', /^end-date-month--\d+$/, 'to_month'], ['id', /^end-date-year--\d+$/, 'to_year'],
      ['id', /^current-role--\d+$/, 'current'],
    ],
    education: [
      ['id', /^school--\d+$/, 'school'], ['id', /^degree--\d+$/, 'degree'], ['id', /^discipline--\d+$/, 'field'],
      ['id', /^start-year--\d+$/, 'from_year'], ['id', /^end-year--\d+$/, 'to_year'],
    ],
  },
  combobox: '#candidate-location, [role="combobox"]',
  options: '[role="option"], .select__option',
});
