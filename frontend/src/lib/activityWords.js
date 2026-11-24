// Activity and audit logs in plain words (Batch E item 48): "Invite sent" instead of "hire.invite", "Drive day
// created" instead of "drive_create". Known codes have their own words; any other code is turned into readable words
// ("auto_apply.pause" -> "Auto apply paused"). Imported only by lazy pages (company, org, admin), never the entry.

const WORDS = {
  'hire.invite': 'Invite sent', 'hire.shortlist': 'Shortlist made', 'hire.bulk': 'Many people invited',
  'hire.bulk_csv': 'People invited from a CSV file', 'hire.bulk_status': 'Status changed for many people',
  'hire.available': 'Marked as ready to join', 'hire.offer_withdraw': 'Offer withdrawn', 'hire.slots': 'Interview times set',
  'hire.slot_book': 'Interview time booked', 'hire.slot_cancel': 'Interview time cancelled',
  'hire.skill_check_start': 'Skill check started', 'hire.skill_check_done': 'Skill check finished', 'hire.walkin_checkin': 'Walk-in checked in',
  hire_filter: 'Hiring filter changed',
  drive_create: 'Drive day created', drive_update: 'Drive day changed', drive_delete: 'Drive day deleted',
  drive_slot: 'Drive time slot added', drive_slot_delete: 'Drive time slot removed', drive_assign: 'Students given drive times',
  drive_mark: 'Drive attendance marked',
  'job.create': 'Job posted', 'job.edit': 'Job changed', 'job.delete': 'Job deleted', 'job.apply': 'Applied to a job',
  'job.withdraw': 'Application withdrawn', 'job.application_status': 'Application status changed',
  'job.applications_viewed': 'Applications viewed', 'job.import': 'Jobs imported', 'job.review': 'Job reviewed',
  'job.link_closed': 'Job link closed',
  'company.signup': 'Company signed up', 'company.edit': 'Details changed', 'company.page': 'Company page updated',
  'company.job_edit': 'Job changed', 'company.team_role': 'Team role changed', 'company.team_remove': 'Team admin removed',
  'company.request_change': 'Change of details requested', 'company.applicant_open': 'Applicant opened',
  'company.applicants_viewed': 'Applicants viewed', 'company.pool': 'Talent pool changed',
  'company.device_signed_out': 'Device signed out', 'company.unusual_login': 'Unusual sign-in',
  'company.hire_features': 'Hiring features changed',
  org_create: 'Organization created', group_create: 'Group created', group_update: 'Group changed',
  member_update: 'Member changed', member_leave: 'Member left', export_csv: 'CSV file downloaded',
  print_bulk: 'Resumes printed in bulk', placement_export: 'Placement report downloaded', kiosk_create: 'Kiosk created', kiosk_revoke: 'Kiosk turned off',
  kiosk_print: 'Resume printed at a kiosk', kiosk_session: 'Kiosk session started',
  owner_transfer_start: 'Owner change started', owner_transfer_done: 'Owner changed',
  recruiter_invite: 'Recruiter invite sent', recruiter_login: 'Recruiter signed in', recruiter_download: 'Resume downloaded',
  recruiter_view: 'Resume viewed', recruiter_feedback: 'Recruiter feedback given',
  'admin.login': 'Admin signed in', 'admin.login_failed': 'Admin sign-in failed', 'admin.created': 'Admin added',
  'admin.password_reset': 'Admin password reset', 'auto_apply.cws_reviewer_created': 'Chrome Web Store reviewer account created',
  'auto_apply.cws_reviewer_password': 'Chrome Web Store reviewer password reset', 'auto_apply.cws_reviewer_password_shown': 'Chrome Web Store reviewer password shown',
  'auth.google_connected': 'Google sign-in connected',
  'auth.google_removed': 'Google sign-in removed', 'account.delete_requested': 'Account deletion asked for',
  'account.delete_undone': 'Account deletion undone', 'account.erased': 'Account erased',
  'account.role_switched': 'Role switched', 'account.roles_added': 'Role added',
};

const PAST = {
  create: 'created', created: 'created', update: 'changed', edit: 'changed', edited: 'changed', delete: 'deleted', deleted: 'deleted',
  add: 'added', remove: 'removed', open: 'opened', opened: 'opened', close: 'closed', book: 'booked', cancel: 'cancelled',
  invite: 'invited', approve: 'approved', reject: 'rejected', revoke: 'revoked', reset: 'reset', start: 'started', done: 'finished',
  assign: 'assigned', export: 'downloaded', login: 'signed in', mark: 'marked', review: 'reviewed', withdraw: 'withdrawn',
  pause: 'paused', resume: 'resumed', print: 'printed', set: 'set', submit: 'sent', send: 'sent', issued: 'issued', run: 'run',
  view: 'viewed', viewed: 'viewed', download: 'downloaded', extend: 'extended', check: 'checked', checked: 'checked',
};
const UPPER = new Set(['csv', 'ai', 'id', 'otp', 'pdf', 'ats', 'gst']);

const sentence = (ws) => {
  const s = ws.filter(Boolean).map((w) => (UPPER.has(w) ? w.toUpperCase() : w)).join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Plain words for an activity or audit code; unknown codes become readable words, never the raw code. */
export function actionWords(code) {
  if (!code) return '';
  if (WORDS[code]) return WORDS[code];
  const parts = String(code).split('.');
  const area = parts.length > 1 ? parts[0].split('_') : [];
  const rest = parts[parts.length - 1].split(/[_\s-]+/).filter(Boolean);
  const last = rest[rest.length - 1];
  if (last && PAST[last]) {
    const subject = [...area, ...rest.slice(0, -1)];
    return sentence([...subject, PAST[last]]);
  }
  return sentence(area.length && rest.join(' ') !== area.join(' ') ? [...area, ...rest] : rest);
}
