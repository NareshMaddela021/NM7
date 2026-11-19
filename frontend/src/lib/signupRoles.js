// Where each "Create free account" button goes. Companies and colleges have their own sign-up flows (For companies,
// For colleges); job seekers and students go to /signup with ?role= picked (a customer account on the API today; the
// values are kept in the link for the one-account sign-up page that comes next). Experts: ?role=expert.

const JOIN = {
  company: '/for-companies',
  college: '/for-orgs?start=1#start',
  seeker: '/signup?role=jobseeker',
  jobseeker: '/signup?role=jobseeker',
  student: '/signup?role=student',
  expert: '/signup?role=expert',
};

/** The sign-up link for a home-page audience (company, college, seeker, student); plain /signup for anything else. */
export const joinLink = (audience) => JOIN[audience] || '/signup';

/** The API account type for /signup?role=… (or the older ?as=expert): 'expert' or 'customer'. */
export function signupAccount(role, as) {
  const k = String(role || '').trim().toLowerCase();
  if (k) return k === 'expert' ? 'expert' : 'customer';
  return as === 'expert' ? 'expert' : 'customer';
}
