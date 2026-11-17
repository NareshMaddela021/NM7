// Nm7 Apply helper: the job boards it never works on. The same list (and the same matching) as the Nm7 server's
// backend/app/autoapply/forms/polite.py JOB_BOARDS; a backend test checks every entry there is here too.
// "linkedin." matches linkedin.com and in.linkedin.com; "shine.com" matches shine.com and www.shine.com, never a longer
// name that only contains it (myshine.com).
(function () {
  const JOB_BOARDS = [
    'linkedin.', 'naukri.', 'indeed.', 'glassdoor.', 'monster.', 'foundit.', 'shine.com', 'timesjobs.',
    'internshala.', 'apna.co', 'workindia.', 'quikr.', 'freshersworld.', 'hirist.', 'instahyre.', 'cutshort.',
    'wellfound.', 'angel.co', 'iimjobs.', 'jobhai.', 'unstop.', 'simplyhired.', 'ziprecruiter.', 'careerbuilder.',
    'jooble.', 'talent.com', 'adzuna.', 'jobrapido.', 'jobsora.', 'whatjobs.', 'placementindia.', 'olx.',
    'facebook.', 'instagram.', 'telegram.', 'whatsapp.', 't.me', 'twitter.', 'x.com', 'hirect.', 'jobsforher.',
    'updazz.', 'fresherworld.', 'careesma.', 'clickindia.', 'jobstreet.', 'seek.com', 'reed.co.uk', 'dice.com',
    'stepstone.', 'naukrigulf.', 'bayt.',
  ];

  function siteOf(host) {
    return String(host || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  }

  function matches(h, b) {
    if (b.endsWith('.')) return h.startsWith(b) || h.includes('.' + b);
    return h === b || h.endsWith('.' + b);
  }

  function isBlocked(host) {
    const h = siteOf(host);
    return !h || JOB_BOARDS.some((b) => matches(h, b));
  }

  globalThis.Nm7Blocklist = { JOB_BOARDS, isBlocked, siteOf };
})();
