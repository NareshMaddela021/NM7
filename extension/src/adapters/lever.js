// Lever (jobs.lever.co): one page, inputs named name / email / phone / org / location, links as urls[LinkedIn],
// the resume upload named resume, extra questions as cards[<id>][field<n>] and "Additional information" as comments.
globalThis.Nm7Adapters.register({
  name: 'lever',
  label: 'Lever',
  hosts: [/(^|\.)lever\.co$/],
  signature: '.application-page .application-question, form[action*="lever.co"]',
  login: '',
  step: '',
  fields: [
    ['name', /^name$/, 'full_name'], ['name', /^email$/, 'email'], ['name', /^phone$/, 'phone'],
    ['name', /^org$/, 'current_company'], ['name', /^location$/, 'city'],
    ['name', /^urls\[LinkedIn\]$/i, 'linkedin'], ['name', /^urls\[GitHub\]$/i, 'github'],
    ['name', /^urls\[(Portfolio|Other)\]$/i, 'portfolio'], ['name', /^comments$/, 'cover'],
    ['name', /^resume$/, 'resume'],
  ],
  sections: {},
  sectionFields: {},
  combobox: '#location-input, input[name="location"][aria-autocomplete]',
  options: '.dropdown-location, [role="option"]',
});
