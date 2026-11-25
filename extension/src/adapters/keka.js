// Keka Hire (*.keka.com/careers): an Angular page. The apply form is one card with sections (Personal details,
// Professional details, Education, Questions); inputs have formcontrolname in camelCase ("firstName",
// "phoneNumber"); the city is a type-to-search list; experience and education are "kh-repeat" blocks.
globalThis.Nm7Adapters.register({
  name: 'keka',
  label: 'Keka',
  hosts: [/(^|\.)keka\.com$/],
  signature: 'kh-apply-form, .kh-careers-apply, [data-kh-form]',
  login: '.kh-login, kh-sign-in',
  step: '.kh-section-title.active, .kh-step-title',
  fields: [
    ['fcn', /^firstName$/, 'first_name'], ['fcn', /^lastName$/, 'last_name'], ['fcn', /^email$/, 'email'],
    ['fcn', /^(phoneNumber|mobileNumber)$/, 'phone'], ['fcn', /^(currentLocation|city)$/, 'city'],
    ['fcn', /^linkedInUrl$/i, 'linkedin'], ['fcn', /^(noticePeriod|noticePeriodInDays)$/, 'notice'],
    ['fcn', /^expectedCtc$/i, 'salary'], ['fcn', /^(currentCompany|currentEmployer)$/, 'current_company'],
    ['fcn', /^(currentDesignation|currentJobTitle)$/, 'current_title'], ['fcn', /^resume$/, 'resume'],
  ],
  sections: {
    work: 'kh-repeat[data-kind="experience"], .kh-experience-block',
    education: 'kh-repeat[data-kind="education"], .kh-education-block',
  },
  sectionFields: {
    work: [
      ['fcn', /^companyName$/, 'company'], ['fcn', /^designation$/, 'title'], ['fcn', /^fromDate$/, 'from'],
      ['fcn', /^toDate$/, 'to'], ['fcn', /^isCurrent$/, 'current'],
    ],
    education: [
      ['fcn', /^(institute|college)$/, 'school'], ['fcn', /^degree$/, 'degree'], ['fcn', /^branch$/, 'field'],
      ['fcn', /^(yearOfPassing|toDate)$/, 'to'], ['fcn', /^fromDate$/, 'from'], ['fcn', /^score$/, 'grade'],
    ],
  },
  combobox: '[role="combobox"], .kh-autocomplete input',
  options: '.kh-option, [role="option"]',
});
