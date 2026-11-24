// SAP SuccessFactors (career sites on successfactors.com / .eu and sapsf.com): SAPUI5 controls. Inputs have the
// class sapMInputBaseInner and an id that ends in the field's name ("…--firstName-inner"), labels are sapMLabel with
// a for= attribute; drop-downs are sapMSlt (a list box opened by a button, left for the candidate) or plain selects
// on the older forms; the application is one long page split into panels, and the profile has "Add" blocks for
// previous employment and education (…--outsideWorkExperience-N, …--education-N).
globalThis.Nm7Adapters.register({
  name: 'successfactors',
  label: 'SuccessFactors',
  hosts: [/(^|\.)successfactors\.(com|eu)$/, /(^|\.)sapsf\.(com|eu|cn)$/, /(^|\.)jobs\.sap\.com$/],
  signature: '.sapMInputBaseInner, [data-sap-ui-area], #rcmCandidateProfile',
  login: '[id$="--loginForm"], .rcmLoginPage, [id*="createAccount"]',
  step: '.sapMPanelHdr[aria-expanded="true"], .rcmStepTitle, h2.sapMTitle',
  fields: [
    ['id', /--firstName(-inner)?$/i, 'first_name'], ['id', /--lastName(-inner)?$/i, 'last_name'],
    ['id', /--(contactEmail|email)(-inner)?$/i, 'email'], ['id', /--(cellPhone|homePhone|phone)(-inner)?$/i, 'phone'],
    ['id', /--city(-inner)?$/i, 'city'], ['id', /--linkedIn(Profile)?(-inner)?$/i, 'linkedin'],
    ['id', /--(currentTitle|jobTitle)(-inner)?$/i, 'current_title'], ['id', /--currentCompany(-inner)?$/i, 'current_company'],
    ['id', /--coverLetter(-inner)?$/i, 'cover'], ['id', /--resume(Upload)?(-input)?$/i, 'resume'],
  ],
  sections: {
    work: '[id*="--outsideWorkExperience-"]',
    education: '[id*="--education-"]',
  },
  sectionFields: {
    work: [
      ['id', /--employer(-inner)?$/i, 'company'], ['id', /--jobTitle(-inner)?$/i, 'title'],
      ['id', /--startDate(-inner)?$/i, 'from'], ['id', /--endDate(-inner)?$/i, 'to'],
      ['id', /--present(-CB)?$/i, 'current'],
    ],
    education: [
      ['id', /--school(-inner)?$/i, 'school'], ['id', /--degree(-inner)?$/i, 'degree'],
      ['id', /--major(-inner)?$/i, 'field'], ['id', /--startDate(-inner)?$/i, 'from'], ['id', /--endDate(-inner)?$/i, 'to'],
    ],
  },
  combobox: '.sapMComboBoxInner, .sapMInputBaseInner[role="combobox"]',
  options: '.sapMSelectListItem, .sapMLIB[role="option"], [role="option"]',
});
