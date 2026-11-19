// globalSetup of playwright.journeys-local.config.mjs: a local owner admin (password + authenticator key) for
// setup.smoke.mjs, Telugu / Hindi shown and three board jobs, on the throwaway e2e database only.
import { PASSWORD, seed } from '../e2e-live/helpers.mjs';

export default function localAdmin() {
  const mail = `owner-journeys-${Date.now()}@nm7.si`;
  const { secret } = seed('admin', mail, 'owner', PASSWORD);
  seed('site-langs', 'on');
  // a few board jobs (the live board has hundreds): an Nm7 apply job, a company-site job and an email job
  const DESC = 'Build weekly dashboards in SQL and Power BI for our retail stores. Freshers are welcome; training is given.';
  const tag = Date.now().toString(36);
  for (const extra of [{ applyMethod: 'nm7' }, { applyMethod: 'link', applyUrl: `https://jobs${tag}.example/apply` }, { applyMethod: 'email', applyEmail: `hr@jobs${tag}.example` }]) {
    seed('job', JSON.stringify({ title: `Data Analyst ${extra.applyMethod} ${tag}`, company: { name: `Journeyco ${extra.applyMethod} ${tag}` }, description: DESC, locations: ['Hyderabad'], experience: 'fresher', skills: ['SQL', 'Power BI'], ...extra }));
  }
  Object.assign(process.env, { SMOKE_ADMIN_EMAIL: mail, SMOKE_ADMIN_PASSWORD: PASSWORD, SMOKE_ADMIN_TOTP: secret });
}
