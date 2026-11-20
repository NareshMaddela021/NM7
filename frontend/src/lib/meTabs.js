// The phone bottom bar of the job seeker / student dashboard (/me). Auto Apply takes the second slot while Admin's
// Auto Apply switch is on (site flags -> autoApply); My orders then lives in the More sheet. With the switch off the
// bar is as before (My orders in the second slot, Auto Apply in More). Desktop's side menu is unchanged.
export const phoneTabs = (autoApplyOn) => ['home', autoApplyOn ? 'auto' : 'orders', 'resumes', 'jobs'];
export const TAB_LABELS = { home: 'Home', orders: 'Orders', auto: 'Auto Apply', resumes: 'Resumes', jobs: 'Jobs' };
