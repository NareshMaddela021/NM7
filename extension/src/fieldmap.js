// Nm7 Apply helper: which kit value goes into which field of a company's apply form. Pure functions (no DOM), so the
// same code runs in the page (content.js) and in the unit tests (frontend/scripts/extension-helper.test.mjs).
//
// A field is described as { tag, type, name, id, label, placeholder, autocomplete, aria, automationId, inCaptcha }.
// planFill(fields, kit, host) returns { fill: [{ index, key, value, how }], skip: [{ index, why }] }:
//   1. per-site maps for the public apply forms of common hiring systems (Greenhouse, Lever, Workday,
//      SmartRecruiters), by the field's name / id / data-automation-id;
//   2. the autocomplete attribute (given-name, email, tel …);
//   3. the label, name, placeholder and aria-label, by plain-word patterns;
//   4. a long text box whose label matches one of the kit's ready answers.
// Never filled: passwords, hidden fields, buttons, check boxes and radio buttons (consent is the candidate's), drop-down
// lists, anything inside a CAPTCHA, sensitive questions (gender, date of birth, religion, caste, disability, ID
// numbers, current salary …) and a file input that isn't for the resume. Nothing here clicks or submits anything.
(function () {
  const SENSITIVE = /gender|\bsex\b|religio|caste|\bcategory\b|marital|date of birth|\bdob\b|birth|\bage\b|disab|handicap|ethnic|\brace\b|veteran|nationality|citizenship|aadha?ar|\bpan\b|passport|social security|\bssn\b|current (?:ctc|salary|compensation|pay)|present (?:ctc|salary)|password|captcha|otp|verification code/i;
  const SKIP_TYPES = new Set(['hidden', 'password', 'submit', 'button', 'image', 'reset', 'checkbox', 'radio', 'range', 'color', 'search']);

  // per-site maps: [hostPattern, [[attribute, pattern, key], ...]]
  const SITE_MAPS = [
    ['greenhouse', /(^|\.)greenhouse\.io$/, [
      ['id', /^first_name$/, 'first_name'], ['id', /^last_name$/, 'last_name'], ['id', /^email$/, 'email'],
      ['id', /^phone$/, 'phone'], ['name', /job_application\[first_name\]/, 'first_name'],
      ['name', /job_application\[last_name\]/, 'last_name'], ['name', /job_application\[email\]/, 'email'],
      ['name', /job_application\[phone\]/, 'phone'], ['name', /job_application\[location\]/, 'city'],
      ['id', /^candidate-location$/, 'city'], ['id', /^cover_letter_text$/, 'cover'],
      ['id', /^resume$/, 'resume'], ['name', /job_application\[resume\]/, 'resume'],
    ]],
    ['lever', /(^|\.)lever\.co$/, [
      ['name', /^name$/, 'full_name'], ['name', /^email$/, 'email'], ['name', /^phone$/, 'phone'],
      ['name', /^org$/, 'current_company'], ['name', /^location$/, 'city'],
      ['name', /^urls\[LinkedIn\]$/i, 'linkedin'], ['name', /^urls\[GitHub\]$/i, 'github'],
      ['name', /^urls\[(Portfolio|Other)\]$/i, 'portfolio'], ['name', /^comments$/, 'cover'],
      ['name', /^resume$/, 'resume'],
    ]],
    ['workday', /(^|\.)(myworkdayjobs|workday)\.com$/, [
      ['automationId', /legalNameSection_firstName/, 'first_name'], ['automationId', /legalNameSection_lastName/, 'last_name'],
      ['automationId', /^email$/, 'email'], ['automationId', /phone-number/, 'phone'],
      ['automationId', /addressSection_city/, 'city'], ['automationId', /linkedinQuestion/i, 'linkedin'],
      ['automationId', /file-upload-input-ref/, 'resume'],
    ]],
    ['smartrecruiters', /(^|\.)smartrecruiters\.com$/, [
      ['id', /^first-name-input$/, 'first_name'], ['id', /^last-name-input$/, 'last_name'],
      ['id', /^(confirm-)?email-input$/, 'email'], ['id', /^phone-number-input$/, 'phone'],
      ['id', /^linkedin-input$/, 'linkedin'], ['id', /^hiring-manager-message-input$/, 'cover'],
      ['id', /^location-input$/, 'city'],
    ]],
  ];

  const AUTOCOMPLETE = {
    'given-name': 'first_name', 'family-name': 'last_name', name: 'full_name', email: 'email', tel: 'phone',
    'tel-national': 'phone', 'address-level2': 'city', organization: 'current_company',
    'organization-title': 'current_title',
  };

  // [pattern on the field's words, key, which tags] — specific before general
  const WORDS = [
    [/first.?name|given.?name|\bfname\b|forename/, 'first_name'],
    [/last.?name|surname|family.?name|\blname\b/, 'last_name'],
    [/full.?name|^name\b|your name|candidate.?name|applicant.?name|^name\s*\*?$/, 'full_name'],
    [/e-?mail/, 'email'],
    [/phone|mobile|contact.?(no|number)|whats.?app|\btel\b/, 'phone'],
    [/linked.?in/, 'linkedin'],
    [/git.?hub/, 'github'],
    [/portfolio|personal.?(site|website)|website|blog/, 'portfolio'],
    [/notice/, 'notice'],
    [/expect\w*.{0,20}(salary|ctc|compensation|pay)|(salary|ctc|compensation).{0,10}expect/, 'salary'],
    [/current.?(company|employer|organi[sz]ation)|company.?name|^employer|present.?employer/, 'current_company'],
    [/current.?(job.?)?(title|role|designation|position)|job.?title|designation/, 'current_title'],
    [/year.?of.?(passing|graduation)|graduation.?year|passing.?year|\bbatch\b|year.?of.?completion/, 'grad_year'],
    [/degree|qualification/, 'degree'],
    [/college|university|institut|school/, 'college'],
    [/\bcity\b|location|where.{0,20}based|town/, 'city'],
    [/cover.?(letter|note)|message|why.{0,40}(join|work|role|us|company|position|interested)|motivation|additional.?information|anything.?else|about.?yourself|summary/, 'cover', 'long'],
    [/resume|\bcv\b|curriculum/, 'resume', 'file'],
  ];

  const STOP = new Set(['the', 'a', 'an', 'you', 'your', 'to', 'for', 'of', 'in', 'is', 'are', 'do', 'what', 'why',
    'how', 'and', 'or', 'this', 'with', 'we', 'us', 'our', 'at', 'on', 'please', 'be', 'can', 'will', 'have']);

  function words(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function text(f) {
    return [f.label, f.aria, f.placeholder, f.name, f.id].map((x) => words(x)).filter(Boolean).join(' | ');
  }

  function siteOf(host) {
    const h = String(host || '').toLowerCase().replace(/^www\./, '');
    const m = SITE_MAPS.find(([, re]) => re.test(h));
    return m ? m[0] : '';
  }

  function isLong(f) {
    return f.tag === 'textarea';
  }

  function tokens(s) {
    return words(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w));
  }

  function answerFor(f, answers) {
    const mine = new Set(tokens(f.label || f.aria || f.placeholder));
    if (mine.size < 2) return null;
    let best = null;
    for (const a of answers || []) {
      const q = tokens(a.question);
      if (!q.length || !a.answer) continue;
      const hit = q.filter((w) => mine.has(w)).length / q.length;
      if (hit >= 0.5 && (!best || hit > best.hit)) best = { hit, value: a.answer };
    }
    return best ? best.value : null;
  }

  function values(kit) {
    const v = {};
    for (const f of kit.fields || []) if (f.value) v[f.key] = f.value;
    if (kit.coverNote) v.cover = kit.coverNote;
    if (kit.resume) v.resume = kit.resume.name || 'resume.pdf';
    return v;
  }

  function keyFor(f, site) {
    if (site) {
      const map = SITE_MAPS.find(([n]) => n === site)[2];
      for (const [attr, re, key] of map) if (f[attr] && re.test(f[attr])) return [key, 'site'];
    }
    const ac = String(f.autocomplete || '').toLowerCase().split(/\s+/).pop();
    if (AUTOCOMPLETE[ac]) return [AUTOCOMPLETE[ac], 'autocomplete'];
    const t = text(f);
    if (!t) return [null, ''];
    for (const [re, key, kind] of WORDS) {
      if (!re.test(t)) continue;
      if (kind === 'file' && f.type !== 'file') continue;
      if (kind !== 'file' && f.type === 'file') continue;
      if (kind === 'long' && !isLong(f)) continue;
      return [key, 'label'];
    }
    return [null, ''];
  }

  function skipWhy(f) {
    const type = String(f.type || '').toLowerCase();
    if (f.inCaptcha) return 'captcha';
    if (type === 'password') return 'password';
    if (SKIP_TYPES.has(type)) return type === 'checkbox' || type === 'radio' ? 'choice' : 'not_a_field';
    if (f.tag === 'select') return 'choice';
    if (f.disabled || f.readOnly) return 'locked';
    if (SENSITIVE.test(text(f).replace(/\|/g, ' '))) return 'sensitive';
    return null;
  }

  function planFill(fields, kit, host) {
    const site = siteOf(host);
    const v = values(kit);
    const fill = [];
    const skip = [];
    fields.forEach((f, index) => {
      const why = skipWhy(f);
      if (why) { skip.push({ index, why }); return; }
      if (f.filled) { skip.push({ index, why: 'already_filled' }); return; }
      let [key, how] = keyFor(f, site);
      if (key === 'resume' && f.type !== 'file') key = null;
      if (f.type === 'file') {
        if (key === 'resume' && v.resume) fill.push({ index, key, value: v.resume, how });
        else skip.push({ index, why: 'other_file' });
        return;
      }
      if (key === 'full_name' && !v.full_name && v.first_name) key = null;
      if (how !== 'site' && (isLong(f) || (!key && f.tag === 'input'))) {
        const ans = answerFor(f, kit.answers); // a ready answer to this very question beats the general cover note
        if (ans) { fill.push({ index, key: 'answer', value: ans, how: 'answer' }); return; }
      }
      if (key && v[key]) { fill.push({ index, key, value: v[key], how }); return; }
      skip.push({ index, why: key ? 'not_in_kit' : 'unknown' });
    });
    return { fill, skip, site };
  }

  globalThis.Nm7FieldMap = { planFill, keyFor, skipWhy, siteOf, answerFor, SITE_MAPS, SENSITIVE };
})();
