// SmartRecruiters (jobs.smartrecruiters.com): one page with ids first-name-input, email-input, phone-number-input,
// linkedin-input and the location as a type-to-search list.
globalThis.Nm7Adapters.register({
  name: 'smartrecruiters',
  label: 'SmartRecruiters',
  hosts: [/(^|\.)smartrecruiters\.com$/],
  signature: 'oc-oneclick-form, #st-apply',
  login: '',
  step: '',
  fields: [
    ['id', /^first-name-input$/, 'first_name'], ['id', /^last-name-input$/, 'last_name'],
    ['id', /^(confirm-)?email-input$/, 'email'], ['id', /^phone-number-input$/, 'phone'],
    ['id', /^linkedin-input$/, 'linkedin'], ['id', /^hiring-manager-message-input$/, 'cover'],
    ['id', /^location-input$/, 'city'],
  ],
  sections: {},
  sectionFields: {},
  combobox: '#location-input',
  options: '[role="option"]',
});
