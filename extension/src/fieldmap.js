// Nm7 Apply helper: which kit value goes into which field of a company's apply form. Pure functions (no DOM), so the
// same code runs in the page (content.js) and in the unit tests (frontend/scripts/extension-helper.test.mjs).
//
// A field is described as { tag, type, widget, name, id, label, question, placeholder, autocomplete, aria,
// automationId, testid, qa, fcn, wrapId, options, inCaptcha, disabled, readOnly, filled, checked, section }.
// widget: text | textarea | select | radio (one per group, options = the choices) | checkbox | date | combobox |
// file | listbutton (a drop-down that only opens with a button press: always left for the candidate).
//
// planFill(fields, kit, host, adapterName) returns { fill: [{ index, key, value, option, how, sure, widget }],
// skip: [{ index, why, label }], site, blocks }:
//   1. the hiring system's adapter (src/adapters/*.js), by the field's name / id / data-automation-id /
//      formcontrolname; inside a repeating work or education block, the block's own fields;
//   2. the autocomplete attribute (given-name, email, tel …);
//   3. the label, name, placeholder and aria-label, by plain-word patterns;
//   4. a text box whose label matches one of the kit's ready answers (a yes / no answer also picks a Yes / No choice).
// `sure` is the confidence colour: true = green (filled, sure), false = yellow (please check). Everything in skip is
// red (left for the candidate) unless `why` says there was nothing to do.
// Never filled: passwords, hidden fields, buttons, anything inside a CAPTCHA, sensitive questions (gender, date of
// birth, religion, caste, disability, ID numbers, current or past salary …), consent and declaration boxes, a check
// box or choice the kit can't back, and a file input that isn't for the resume. Nothing here clicks or submits.
(function () {
  const A = globalThis.Nm7Adapters || { byName: () => null, forHost: () => null };
  const SENSITIVE = /gender|\bsex\b|pronoun|sexual|orientation|religio|caste|\bcategory\b|community|marital|spouse|date of birth|\bdob\b|birth|\bage\b|disab|handicap|impair|medical|health|pregnan|blood group|ethnic|\brace\b|veteran|military|nationality|citizenship|visa|work (permit|authori[sz]ation)|criminal|convict|arrest|aadha?ar|\bpan\b|passport|social security|\bssn\b|national id|voter|driving licen|(current|present|last|previous|past) (ctc|salary|compensation|pay|drawn)|salary (history|slip)|last drawn|payslip|father|mother|password|captcha|otp|one.?time|verification code|security (question|answer)/i;
  const SENSITIVE_OPTION = /^(male|female|transgender|non.?binary|hindu|muslim|christian|sikh|buddhist|jain|sc|st|obc|general|ews|married|unmarried|single|divorced|widowed)$/i;
  const CONSENT = /agree|consent|terms|privacy|policy|declar|certif|acknowledg|confirm|authori[sz]|accept|subscribe|newsletter|marketing|updates by|contact me|whatsapp|\bsms\b|true and correct|background (check|verification)/i;
  const SKIP_TYPES = new Set(['hidden', 'password', 'submit', 'button', 'image', 'reset', 'range', 'color', 'search']);
  const STRONG = new Set(['first_name', 'last_name', 'full_name', 'email', 'phone', 'linkedin', 'github', 'portfolio', 'resume']);

  const AUTOCOMPLETE = {
    'given-name': 'first_name', 'family-name': 'last_name', name: 'full_name', email: 'email', tel: 'phone',
    'tel-national': 'phone', 'address-level2': 'city', organization: 'current_company',
    'organization-title': 'current_title',
  };

  // [pattern on the field's words, key, which kind of field] — specific before general
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

  // inside a repeating work / education block
  const SECTION_WORDS = {
    work: [
      [/currently|present|current.?(role|job|employer)|i work here/, 'current'],
      [/company|employer|organi[sz]ation/, 'company'],
      [/title|designation|role|position/, 'title'],
      [/location|city/, 'location'],
      [/from|start|joined|begin/, 'from'],
      [/\bto\b|end|until|till|left/, 'to'],
      [/description|responsibilit|summary|duties|achievement/, 'description'],
    ],
    education: [
      [/school|college|university|institut/, 'school'],
      [/degree|qualification|course|program/, 'degree'],
      [/field|major|special|branch|stream|discipline|department/, 'field'],
      [/grade|cgpa|gpa|percentage|score|marks/, 'grade'],
      [/from|start|begin|first year/, 'from'],
      [/\bto\b|end|passing|graduat|completion|last year/, 'to'],
    ],
  };

  const STOP = new Set(['the', 'a', 'an', 'you', 'your', 'to', 'for', 'of', 'in', 'is', 'are', 'do', 'what', 'why',
    'how', 'and', 'or', 'this', 'with', 'we', 'us', 'our', 'at', 'on', 'please', 'be', 'can', 'will', 'have']);

  // the same thing written two ways on forms (degree names, notice periods)
  const SAME = [
    ['b com', 'bcom', 'bachelor of commerce'], ['b tech', 'btech', 'bachelor of technology'],
    ['b e', 'be', 'bachelor of engineering'], ['b sc', 'bsc', 'bachelor of science'],
    ['bca', 'bachelor of computer applications'], ['bba', 'bachelor of business administration'],
    ['b a', 'ba', 'bachelor of arts'], ['m com', 'mcom', 'master of commerce'], ['m tech', 'mtech', 'master of technology'],
    ['m sc', 'msc', 'master of science'], ['mca', 'master of computer applications'],
    ['mba', 'master of business administration'], ['m a', 'ma', 'master of arts'],
    ['immediate', 'immediately', '0 days', 'no notice', 'serving notice'], ['15 days', '2 weeks', 'two weeks'],
    ['30 days', '1 month', 'one month', '4 weeks'], ['60 days', '2 months', 'two months'],
    ['90 days', '3 months', 'three months'],
  ];

  function words(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function text(f) {
    return [f.label, f.question, f.aria, f.placeholder, f.name, f.id, f.fcn].map((x) => words(x)).filter(Boolean).join(' | ');
  }

  function labelOf(f) {
    return String(f.question || f.label || f.aria || f.placeholder || f.name || f.id || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function adapterFor(host, name) {
    return (name && A.byName(name)) || A.forHost(host) || null;
  }

  function siteOf(host) {
    const a = A.forHost(host);
    return a ? a.name : '';
  }

  function tokens(s) {
    return words(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w));
  }

  function expand(s) {
    const w = words(s);
    const out = new Set([w]);
    for (const group of SAME) {
      if (group.some((g) => w === g || (` ${w} `).includes(` ${g} `))) group.forEach((g) => out.add(g));
    }
    return [...out];
  }

  // how well an option's text matches a value: 1 exact, else the best of starts-with / contains / shared words
  function score(option, value) {
    const o = words(option);
    if (!o) return 0;
    let best = 0;
    for (const v of expand(value)) {
      for (const x of expand(o)) {
        if (x === v) return 1;
        if (x.startsWith(v) || v.startsWith(x)) best = Math.max(best, 0.85 * Math.min(x.length, v.length) / Math.max(x.length, v.length) + 0.1);
        else if (x.includes(v) || v.includes(x)) best = Math.max(best, 0.7 * Math.min(x.length, v.length) / Math.max(x.length, v.length) + 0.1);
      }
      const vt = new Set(tokens(v));
      const ot = tokens(o);
      if (vt.size && ot.length) best = Math.max(best, ot.filter((t) => vt.has(t)).length / Math.max(vt.size, ot.length));
    }
    return Math.min(best, 0.99);
  }

  // the best option for a value → { index, score, exact } (index -1: nothing close enough)
  function matchOption(options, value, min = 0.5) {
    let best = { index: -1, score: 0, exact: false };
    (options || []).forEach((o, i) => {
      if (/^\s*(select|choose|pick|--|please)/i.test(o) || !String(o).trim()) return;
      const s = score(o, value);
      if (s > best.score) best = { index: i, score: s, exact: s === 1 };
    });
    return best.score >= min ? best : { index: -1, score: best.score, exact: false };
  }

  function answerFor(f, answers) {
    const mine = new Set(tokens(f.question || f.label || f.aria || f.placeholder));
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

  function yesNo(answer) {
    const m = /^\s*(yes|no)\b/i.exec(String(answer || ''));
    return m ? m[1].toLowerCase() : null;
  }

  function values(kit) {
    const v = {};
    for (const f of kit.fields || []) if (f.value) v[f.key] = f.value;
    if (kit.coverNote) v.cover = kit.coverNote;
    if (kit.resume) v.resume = kit.resume.name || 'resume.pdf';
    return v;
  }

  // ---------- dates ----------

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function parseDate(v) {
    const s = String(v || '').trim();
    let m = /^(\d{4})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?$/.exec(s);
    if (m) return { y: m[1], m: m[2] ? m[2].padStart(2, '0') : '', d: m[3] ? m[3].padStart(2, '0') : '' };
    m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(s);
    if (m && MONTHS.includes(m[1].toLowerCase())) return { y: m[2], m: String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0'), d: '' };
    return null;
  }

  function dateFormat(f) {
    const hint = `${f.placeholder} ${f.aria} ${f.label}`.toLowerCase();
    const m = /(dd|mm|yyyy)([-/. ])(mm|dd|yyyy)(?:\2(dd|mm|yyyy))?/.exec(hint);
    if (m) return m[0];
    if (/\bmonth\b|\bmm\b/.test(hint) && !/year|yyyy/.test(hint)) return 'mm';
    if (/\byear\b|yyyy/.test(hint) && !/month|\bmm\b|\bdd\b/.test(hint)) return 'yyyy';
    return '';
  }

  // → { value, sure } or null; `part` is 'month' / 'year' for a split date
  function formatDate(raw, f, part) {
    const d = parseDate(raw);
    if (!d) return null;
    const type = String(f.type || '').toLowerCase();
    if (part === 'year' || (!part && dateFormat(f) === 'yyyy')) return { value: d.y, sure: true };
    if (part === 'month' || (!part && dateFormat(f) === 'mm')) {
      if (!d.m) return null;
      if (f.widget === 'select' || f.widget === 'combobox') return { value: MONTHS[Number(d.m) - 1], sure: false, month: Number(d.m) };
      return { value: d.m, sure: true };
    }
    if (type === 'month') return d.m ? { value: `${d.y}-${d.m}`, sure: true } : null;
    if (type === 'date') return d.m ? { value: `${d.y}-${d.m}-${d.d || '01'}`, sure: !!d.d } : null;
    const fmt = dateFormat(f);
    if (fmt) {
      const out = fmt.replace('yyyy', d.y).replace('mm', d.m || '01').replace('dd', d.d || '01');
      return { value: out, sure: !!d.m && (!/dd/.test(fmt) || !!d.d) };
    }
    if (!d.m) return { value: d.y, sure: false };
    return { value: `${d.m}/${d.y}`, sure: false }; // no format shown: month / year, yellow
  }

  function datePart(f) {
    const t = `${f.automationId} ${f.id} ${f.name} ${f.fcn} ${f.label} ${f.placeholder} ${f.aria}`.toLowerCase();
    if (/month|\bmm\b/.test(t) && !/year|yyyy/.test(t)) return 'month';
    if (/year|yyyy/.test(t) && !/month|\bmm\b|\bdd\b|date/.test(t)) return 'year';
    return '';
  }

  // ---------- which key ----------

  function byMap(f, map) {
    for (const [attr, re, key] of map || []) if (f[attr] && re.test(f[attr])) return key;
    return null;
  }

  function keyFor(f, adapter) {
    if (adapter && typeof adapter === 'string') adapter = A.byName(adapter);
    if (adapter) {
      const k = byMap(f, adapter.fields);
      if (k) return [k, 'site'];
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

  function sectionKey(f, adapter) {
    const kind = f.section.kind;
    let key = adapter && byMap(f, (adapter.sectionFields || {})[kind]);
    let how = key ? 'site' : 'label';
    if (!key) {
      const t = text(f);
      const hit = (SECTION_WORDS[kind] || []).find(([re]) => re.test(t));
      key = hit ? hit[1] : null;
    }
    if ((key === 'from' || key === 'to') && datePart(f)) key = `${key}_${datePart(f)}`;
    return [key, key ? how : ''];
  }

  function isLong(f) {
    return f.tag === 'textarea' || f.widget === 'textarea';
  }

  function isQuestion(f) {
    const l = String(f.question || f.label || f.aria || '').trim();
    return (f.widget === 'text' || f.widget === 'textarea') && (l.endsWith('?') || tokens(l).length >= 3);
  }

  function skipWhy(f) {
    const type = String(f.type || '').toLowerCase();
    if (f.inCaptcha) return 'captcha';
    if (type === 'password') return 'password';
    if (SKIP_TYPES.has(type)) return 'not_a_field';
    if (f.widget === 'listbutton') return 'needs_click';
    if (f.disabled || f.readOnly) return 'locked';
    const t = text(f).replace(/\|/g, ' ');
    if (SENSITIVE.test(t)) return 'sensitive';
    if ((f.options || []).some((o) => SENSITIVE_OPTION.test(String(o).trim()))) return 'sensitive';
    if (f.widget === 'checkbox' && CONSENT.test(t)) return 'consent';
    return null;
  }

  // a value for this field from `value` (a string), by the kind of field → { value, option, sure } or null
  function shape(f, key, value, how) {
    const strong = STRONG.has(key) && how !== 'answer';
    const base = how === 'site' || how === 'autocomplete' || strong;
    if (f.widget === 'select' || f.widget === 'radio') {
      const m = matchOption(f.options, value);
      if (m.index < 0) return null;
      return { value: f.options[m.index], option: m.index, sure: base && m.exact };
    }
    if (f.widget === 'date') {
      const d = formatDate(value, f, '');
      return d ? { value: d.value, sure: false } : null;
    }
    return { value, sure: base && f.widget !== 'combobox' ? true : base && f.widget === 'combobox' ? null : false };
  }

  function planSection(f, index, kit, adapter, fill, skip) {
    const list = f.section.kind === 'work' ? kit.experience || [] : kit.education || [];
    const entry = list[f.section.index];
    const label = labelOf(f);
    if (!entry) { skip.push({ index, why: 'not_in_kit', label }); return; }
    const [key, how] = sectionKey(f, adapter);
    if (!key) { skip.push({ index, why: 'unknown', label }); return; }
    if (key === 'current') {
      if (f.widget !== 'checkbox') { skip.push({ index, why: 'unknown', label }); return; }
      if (entry.current && !f.checked) fill.push({ index, key, value: true, how, sure: true, widget: 'checkbox' });
      else skip.push({ index, why: 'nothing_to_do', label });
      return;
    }
    const base = key.replace(/_(month|year)$/, '');
    const part = (key.match(/_(month|year)$/) || [])[1] || '';
    if (base === 'to' && entry.current) { skip.push({ index, why: 'nothing_to_do', label }); return; }
    const raw = entry[base === 'school' ? 'school' : base];
    if (!raw) { skip.push({ index, why: 'not_in_kit', label }); return; }
    if (base === 'from' || base === 'to') {
      const d = formatDate(raw, f, part || (f.widget === 'select' || f.widget === 'combobox' ? datePart(f) : ''));
      if (!d) { skip.push({ index, why: 'not_in_kit', label }); return; }
      if (f.widget === 'select' || f.widget === 'combobox' || f.widget === 'radio') {
        const opts = d.month ? (f.options || []).map((o) => String(o)) : f.options;
        let m = matchOption(opts, d.value);
        if (m.index < 0 && d.month) m = matchOption(opts, String(d.month).padStart(2, '0'));
        if (m.index < 0 && d.month) m = matchOption(opts, String(d.month));
        if (f.widget === 'combobox') { fill.push({ index, key, value: d.value, how, sure: null, widget: f.widget }); return; }
        if (m.index < 0) { skip.push({ index, why: 'choice', label }); return; }
        fill.push({ index, key, value: f.options[m.index], option: m.index, how, sure: m.exact && d.sure, widget: f.widget });
        return;
      }
      fill.push({ index, key, value: d.value, how, sure: d.sure && how === 'site', widget: f.widget });
      return;
    }
    const s = shape(f, key, String(raw), how);
    if (!s) { skip.push({ index, why: 'choice', label }); return; }
    fill.push({ index, key, value: s.value, option: s.option, how, sure: s.sure === null ? null : how === 'site' && s.sure !== false, widget: f.widget });
  }

  function planFill(fields, kit, host, adapterName) {
    const adapter = adapterFor(host, adapterName);
    const v = values(kit);
    const fill = [];
    const skip = [];
    const blocks = { work: new Set(), education: new Set() };
    fields.forEach((f, index) => {
      f.widget = f.widget || (f.tag === 'select' ? 'select' : f.tag === 'textarea' ? 'textarea' : f.type === 'file' ? 'file' : f.type === 'checkbox' ? 'checkbox' : f.type === 'radio' ? 'radio' : 'text');
      const label = labelOf(f);
      if (f.section && blocks[f.section.kind]) blocks[f.section.kind].add(f.section.index);
      const why = skipWhy(f);
      if (why) { skip.push({ index, why, label }); return; }
      if (f.filled) { skip.push({ index, why: 'already_filled', label }); return; }
      if (f.section && (f.section.kind === 'work' || f.section.kind === 'education')) { planSection(f, index, kit, adapter, fill, skip); return; }
      let [key, how] = keyFor(f, adapter);
      if (key === 'resume' && f.type !== 'file') key = null;
      if (f.type === 'file') {
        if (key === 'resume' && v.resume) fill.push({ index, key, value: v.resume, how, sure: true, widget: 'file' });
        else skip.push({ index, why: 'other_file', label });
        return;
      }
      if (key === 'full_name' && !v.full_name && v.first_name) key = null;
      // a ready answer to this very question beats the general cover note; a yes / no answer picks a choice
      if (how !== 'site' && (isLong(f) || (!key && f.tag === 'input') || f.widget === 'radio' || f.widget === 'checkbox' || f.widget === 'select')) {
        const ans = answerFor(f, kit.answers);
        if (ans && (f.widget === 'radio' || f.widget === 'select')) {
          const yn = yesNo(ans);
          const m = yn ? matchOption(f.options, yn, 0.9) : matchOption(f.options, ans, 0.6);
          if (m.index >= 0) { fill.push({ index, key: 'answer', value: f.options[m.index], option: m.index, how: 'answer', sure: false, widget: f.widget }); return; }
        } else if (ans && f.widget === 'checkbox') {
          if (yesNo(ans) === 'yes' && !f.checked) { fill.push({ index, key: 'answer', value: true, how: 'answer', sure: false, widget: 'checkbox' }); return; }
          skip.push({ index, why: yesNo(ans) === 'no' ? 'nothing_to_do' : 'choice', label }); return;
        } else if (ans && f.widget !== 'date') {
          fill.push({ index, key: 'answer', value: ans, how: 'answer', sure: false, widget: f.widget }); return;
        }
      }
      if (f.widget === 'checkbox') { skip.push({ index, why: 'choice', label }); return; }
      if (key && v[key]) {
        const s = shape(f, key, v[key], how);
        if (!s) { skip.push({ index, why: 'choice', label }); return; }
        fill.push({ index, key, value: s.value, option: s.option, how, sure: s.sure, widget: f.widget });
        return;
      }
      if (!key && isQuestion(f)) { skip.push({ index, why: 'question', label }); return; }
      skip.push({ index, why: key ? 'not_in_kit' : f.widget === 'radio' || f.widget === 'select' ? 'choice' : 'unknown', label });
    });
    return {
      fill, skip, site: adapter ? adapter.name : '', label: adapter ? adapter.label : '',
      blocks: { work: blocks.work.size, education: blocks.education.size },
      more: {
        work: Math.max(0, (kit.experience || []).length - blocks.work.size),
        education: Math.max(0, (kit.education || []).length - blocks.education.size),
      },
    };
  }

  // Red reasons (left for the candidate) and the ones that are not worth a colour
  const QUIET = new Set(['already_filled', 'nothing_to_do', 'not_a_field', 'password', 'captcha']);

  // For the opt-in miss report: the label only, with anything that could be a value or a person taken out
  function cleanLabel(s) {
    return String(s || '')
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ')
      .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
      .replace(/\d[\d\s-]{2,}\d|\d{3,}/g, ' ')
      .replace(/[*:]+\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  function misses(fields, plan) {
    const out = [];
    const seen = new Set();
    for (const s of plan.skip) {
      if (s.why !== 'unknown' && s.why !== 'question' && s.why !== 'choice') continue;
      const f = fields[s.index];
      const label = cleanLabel(f.question || f.label || f.aria || f.placeholder);
      const type = String(f.widget || f.type || 'text').slice(0, 20);
      const k = `${label}|${type}`;
      if (label.length < 2 || seen.has(k)) continue;
      seen.add(k);
      out.push({ label, type });
    }
    return out.slice(0, 30);
  }

  globalThis.Nm7FieldMap = {
    planFill, keyFor, skipWhy, siteOf, answerFor, matchOption, formatDate, parseDate, misses, cleanLabel, yesNo,
    SENSITIVE, CONSENT, QUIET,
  };
})();
