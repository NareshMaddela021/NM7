// iCIMS (careers-<company>.icims.com): the company's careers page shows the form inside an iframe
// (#icims_content_iframe, an icims.com page); the flow starts with an email-only "Enter your email" page (left alone:
// that is the sign-in), then Profile, Experience and Questions pages, each a full page load inside the frame. Fields
// are named "PersonProfileFields.<Name>" and the work / education rows "<Table>.<row>.<Field>".
globalThis.Nm7Adapters.register({
  name: 'icims',
  label: 'iCIMS',
  hosts: [/(^|\.)icims\.com$/],
  signature: '#icims_content_iframe, .iCIMS_MainWrapper, [name^="PersonProfileFields."]',
  login: '#enterEmailForm, .iCIMS_LoginForm, [name="loginName"]',
  step: '.iCIMS_PageHeader h1, .iCIMS_Header h2, h2.iCIMS_InfoMsg_Step',
  frame: '#icims_content_iframe',
  fields: [
    ['name', /^PersonProfileFields\.FirstName$/, 'first_name'], ['name', /^PersonProfileFields\.LastName$/, 'last_name'],
    ['name', /^PersonProfileFields\.Email$/, 'email'], ['name', /^PersonProfileFields\.(PhoneNumber|Mobile)$/, 'phone'],
    ['name', /^PersonProfileFields\.City$/, 'city'], ['name', /^PersonProfileFields\.LinkedIn/i, 'linkedin'],
    ['name', /^PersonProfileFields\.CoverLetter$/, 'cover'], ['name', /^(PersonProfileFields\.)?Resume(File)?$/i, 'resume'],
  ],
  sections: {
    work: '.iCIMS_TableRow[data-table="WorkExperience"], fieldset.workexperience',
    education: '.iCIMS_TableRow[data-table="Education"], fieldset.education',
  },
  sectionFields: {
    work: [
      ['name', /\.Employer$/, 'company'], ['name', /\.Title$/, 'title'], ['name', /\.StartDate$/, 'from'],
      ['name', /\.EndDate$/, 'to'], ['name', /\.IsCurrent$/, 'current'], ['name', /\.Description$/, 'description'],
    ],
    education: [
      ['name', /\.School$/, 'school'], ['name', /\.Degree$/, 'degree'], ['name', /\.Major$/, 'field'],
      ['name', /\.GraduationDate$/, 'to'],
    ],
  },
  combobox: '[role="combobox"]',
  options: '[role="option"]',
});
