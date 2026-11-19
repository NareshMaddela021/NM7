// globalSetup of playwright.journeys-local.config.mjs: a local owner admin (password + authenticator key) for
// setup.smoke.mjs, and Telugu / Hindi shown, on the throwaway e2e database only.
import { PASSWORD, seed } from '../e2e-live/helpers.mjs';

export default function localAdmin() {
  const mail = `owner-journeys-${Date.now()}@nm7.si`;
  const { secret } = seed('admin', mail, 'owner', PASSWORD);
  seed('site-langs', 'on');
  Object.assign(process.env, { SMOKE_ADMIN_EMAIL: mail, SMOKE_ADMIN_PASSWORD: PASSWORD, SMOKE_ADMIN_TOTP: secret });
}
