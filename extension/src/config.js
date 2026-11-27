// Nm7 Apply helper: where Nm7's API is. The only site the helper talks to (manifest host_permissions).
// For a test server, change both this address and host_permissions in manifest.json, and load the folder unpacked.
// pageFiles: the scripts injected into the company's page (and its frames) when the candidate taps Fill, in order.
// The Chrome Web Store link for the one-time rating request comes from Nm7's API (a setting in Admin > Auto Apply,
// empty until the listing is approved: no link, no request).
globalThis.NM7_CONFIG = {
  api: 'https://nm7-api.onrender.com/api/helper',
  site: 'https://nm7.si',
  practice: 'https://nm7.si/demo/apply/customer-support-executive',
  pageFiles: [
    'src/blocklist.js',
    'src/adapters/index.js', 'src/adapters/workday.js', 'src/adapters/successfactors.js', 'src/adapters/taleo.js',
    'src/adapters/icims.js', 'src/adapters/darwinbox.js', 'src/adapters/keka.js', 'src/adapters/greenhouse.js',
    'src/adapters/lever.js', 'src/adapters/zoho.js', 'src/adapters/smartrecruiters.js',
    'src/fieldmap.js', 'src/widgets.js', 'src/content.js',
  ],
};
