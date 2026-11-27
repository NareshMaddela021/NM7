// Workday (*.myworkdayjobs.com): a single-page app where every control carries a data-automation-id. The apply flow
// is steps (My Information, My Experience, Application Questions, Voluntary Disclosures, Review) with the step title
// in pageHeaderTitle; work and education are repeating blocks (workExperience-N, education-N) with month and year
// date parts; "prompt" inputs are type-to-search lists (promptOption); drop-downs are buttons with a list box
// (left for the candidate: the helper never presses buttons).
globalThis.Nm7Adapters.register({
  name: 'workday',
  label: 'Workday',
  hosts: [/(^|\.)myworkdayjobs\.com$/, /(^|\.)myworkdaysite\.com$/, /(^|\.)myworkday\.com$/],
  signature: '[data-automation-id="applyFlowPage"], [data-automation-id^="legalNameSection_"]',
  login: '[data-automation-id="signInContent"], [data-automation-id="createAccountPage"], [data-automation-id="signInFormo"]',
  step: '[data-automation-id="pageHeaderTitle"], [data-automation-id="progressBar"] [aria-current="step"]',
  fields: [
    ['automationId', /^legalNameSection_firstName$/, 'first_name'],
    ['automationId', /^legalNameSection_lastName$/, 'last_name'],
    ['automationId', /^email$/, 'email'],
    ['automationId', /^phone-number$/, 'phone'],
    ['automationId', /^addressSection_city$/, 'city'],
    ['automationId', /linkedinQuestion|^linkedIn$/i, 'linkedin'],
    ['automationId', /^websiteQuestion$/i, 'portfolio'],
    ['automationId', /^file-upload-input-ref$/, 'resume'],
  ],
  sections: {
    work: '[data-automation-id^="workExperience-"]',
    education: '[data-automation-id^="education-"]',
  },
  sectionFields: {
    work: [
      ['automationId', /^jobTitle$/, 'title'], ['automationId', /^company$/, 'company'],
      ['automationId', /^location$/, 'location'], ['automationId', /^currentlyWorkHere$/, 'current'],
      ['automationId', /^description$/, 'description'],
      ['wrapId', /startDate/i, 'from'], ['wrapId', /endDate/i, 'to'],
    ],
    education: [
      ['automationId', /^school$/, 'school'], ['automationId', /^degree$/, 'degree'],
      ['automationId', /^fieldOfStudy$/, 'field'], ['automationId', /^gradeAverage$/, 'grade'],
      ['wrapId', /firstYearAttended/i, 'from'], ['wrapId', /lastYearAttended/i, 'to'],
    ],
  },
  combobox: '[data-automation-id="searchBox"], [data-uxi-widget-type="selectinput"]',
  options: '[data-automation-id="promptOption"], [role="option"]',
});
