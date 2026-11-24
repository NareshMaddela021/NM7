// Nm7 Apply helper, in the company's apply page (and in each frame of it the helper may reach). Injected only when
// the candidate taps "Fill this page" in the helper (activeTab), never on its own and never on a job board.
//
// It types the candidate's own kit values into empty fields, chooses the matching option in drop-downs, radio
// buttons and type-to-search lists, fills the work and education blocks already on the page, attaches the tailored
// resume PDF where the page allows it, colours every field (green: filled, sure; yellow: please check; red: left
// for you; each with a text badge too) and shows a small status bar ("9 filled, 2 to check, 1 for you": tap it to
// go to the next one to check), with Undo. Then it STOPS. It never presses the company's Submit, Next, Add or any
// other button, never sends the form, never presses Enter, never touches a CAPTCHA, never fills a password and never
// signs in or creates an account. When the candidate moves to the next step themselves, it offers "Fill this step"
// (the candidate taps it). When they press Submit, the colours go and it offers "Mark as applied on Nm7"; it does
// not stop or change the company's own submit in any way.
(function () {
  if (globalThis.Nm7Fill) return;
  const MAP = globalThis.Nm7FieldMap;
  const BLOCK = globalThis.Nm7Blocklist;
  const ADAPT = globalThis.Nm7Adapters;
  const W = globalThis.Nm7Widgets;
  const CAPTCHA = '[class*="captcha" i],[id*="captcha" i],[name*="captcha" i],.g-recaptcha,.h-captcha,.cf-turnstile,[data-sitekey]';
  const HOSTED_FRAME = /(greenhouse\.io|lever\.co|myworkdayjobs\.com|smartrecruiters\.com|ashbyhq\.com|workable\.com|icims\.com|taleo\.net|successfactors\.(com|eu)|zohorecruit\.|darwinbox\.|keka\.com)/i;
  const WORK_HEAD = /(work|employment|job|professional)\s*(experience|history|details)|experience\s*\d|employer\s*\d|previous (job|employment)/i;
  const EDU_HEAD = /education|qualification|academic/i;
  const COLOURS = { sure: '#15803d', check: '#b45309', left: '#b91c1c', draft: '#6d28d9' };
  const BADGE = { sure: 'Nm7: filled', check: 'Nm7: please check', left: 'Nm7: left for you', draft: 'Nm7: draft, check it' };
  const CLEAR_AFTER = 20 * 60 * 1000;
  const S = {
    kit: null, pdf: null, touched: new Map(), marks: new Map(), steps: new Set(), questions: [], drafts: new Map(),
    observer: null, timer: null, clearTimer: null, busy: false, offered: '', note: '',
  };

  // ---------- reading the form ----------

  function textOf(n) {
    return n ? String(n.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function labelOf(el) {
    const parts = [];
    if (el.labels) for (const l of el.labels) parts.push(textOf(l));
    const by = el.getAttribute('aria-labelledby');
    if (by) for (const id of by.split(/\s+/)) parts.push(textOf(document.getElementById(id)));
    if (!parts.join('').trim()) {
      const wrap = el.closest('label, .field, .form-group, .application-question, [class*="field" i], [data-automation-id^="formField"], li, p, div');
      if (wrap) {
        const lab = wrap.querySelector('label, legend, .label, [class*="label" i]');
        if (lab && !lab.contains(el)) parts.push(textOf(lab));
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  function questionOf(el) {
    const fs = el.closest('fieldset, [role="radiogroup"], [role="group"]');
    if (!fs) return '';
    const lg = fs.querySelector('legend');
    if (lg) return textOf(lg).slice(0, 200);
    const by = fs.getAttribute('aria-labelledby');
    if (by) return by.split(/\s+/).map((id) => textOf(document.getElementById(id))).join(' ').slice(0, 200);
    return String(fs.getAttribute('aria-label') || '').slice(0, 200);
  }

  function wrapIdOf(el) {
    let n = el.parentElement;
    for (let i = 0; n && i < 5; i += 1, n = n.parentElement) {
      const v = n.getAttribute('data-automation-id') || n.getAttribute('data-testid') || n.id;
      if (v) return v;
    }
    return '';
  }

  function sel(adapter, key) {
    return (adapter && adapter[key]) || '';
  }

  function safeAll(selector, root = document) {
    if (!selector) return [];
    try { return Array.from(root.querySelectorAll(selector)); } catch { return []; }
  }

  function outermost(list) {
    return list.filter((b) => !list.some((o) => o !== b && o.contains(b)));
  }

  // the repeating work / education blocks on the page, in page order → [{ kind, index, el }]
  function sectionsOf(adapter) {
    const out = [];
    for (const kind of ['work', 'education']) {
      let blocks = outermost(safeAll(sel(adapter && adapter.sections, kind)));
      if (!blocks.length) {
        const re = kind === 'work' ? WORK_HEAD : EDU_HEAD;
        blocks = safeAll('fieldset, section, [role="group"], [data-section]').filter((b) => {
          const h = b.querySelector('legend, h2, h3, h4, [role="heading"]');
          return h && re.test(textOf(h)) && b.querySelectorAll('input, textarea, select').length >= 2;
        });
        blocks = blocks.filter((b) => !blocks.some((o) => o !== b && b.contains(o)));
      }
      blocks.forEach((el, index) => out.push({ kind, index, el }));
    }
    return out;
  }

  function widgetOf(el, adapter) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'button') return 'listbutton';
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    if (type === 'radio') return 'radio';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'file') return 'file';
    if (type === 'date' || type === 'month') return 'date';
    const cb = sel(adapter, 'combobox');
    const auto = (el.getAttribute('aria-autocomplete') || '').toLowerCase();
    if (el.getAttribute('role') === 'combobox' || auto === 'list' || auto === 'both' || el.getAttribute('list')) return 'combobox';
    if (cb) { try { if (el.matches(cb) || el.closest(cb)) return 'combobox'; } catch { /* a bad selector */ } }
    const hint = `${el.getAttribute('placeholder') || ''}`.toLowerCase();
    if (/(dd|mm)[/.-](mm|dd|yyyy)|yyyy-mm/.test(hint)) return 'date';
    return 'text';
  }

  function visibleControl(el) {
    if (el.closest('[id^="nm7-"]')) return false;
    if (el.type === 'file') return true; // upload inputs are often hidden behind a styled button
    if (el.type === 'hidden') return false;
    return W.isVisible(el);
  }

  function collect() {
    const adapter = ADAPT.detect(location.hostname, document);
    const sections = sectionsOf(adapter);
    const raw = Array.from(document.querySelectorAll('input, textarea, select, button[aria-haspopup="listbox"]')).filter(visibleControl);
    const items = [];
    const groups = new Map();
    for (const el of raw) {
      if (el.type === 'radio') {
        const key = el.name || questionOf(el) || el.id;
        if (!groups.has(key)) { const g = { radio: true, inputs: [] }; groups.set(key, g); items.push(g); }
        groups.get(key).inputs.push(el);
      } else items.push({ el });
    }
    const fields = items.map((it) => describe(it, adapter, sections));
    return { adapter, items, fields };
  }

  function describe(it, adapter, sections) {
    const el = it.radio ? it.inputs[0] : it.el;
    const sec = sections.find((s) => s.el.contains(el));
    const base = {
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute('type') || (el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select' : 'text')).toLowerCase(),
      widget: widgetOf(el, adapter),
      name: el.getAttribute('name') || '',
      id: el.id || '',
      label: it.radio ? '' : labelOf(el),
      question: questionOf(el),
      placeholder: el.getAttribute('placeholder') || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      aria: el.getAttribute('aria-label') || '',
      automationId: el.getAttribute('data-automation-id') || '',
      testid: el.getAttribute('data-testid') || '',
      qa: el.getAttribute('data-qa') || '',
      fcn: el.getAttribute('formcontrolname') || '',
      wrapId: wrapIdOf(el),
      inCaptcha: !!el.closest(CAPTCHA),
      disabled: !!el.disabled,
      readOnly: !!el.readOnly,
      checked: !!el.checked,
      section: sec ? { kind: sec.kind, index: sec.index } : null,
    };
    if (it.radio) {
      base.options = it.inputs.map((i) => labelOf(i) || i.value);
      base.filled = it.inputs.some((i) => i.checked);
      if (!base.question) base.question = base.name;
    } else if (base.widget === 'select') {
      base.options = Array.from(el.options).map((o) => textOf(o));
      base.filled = el.selectedIndex > 0 || (el.selectedIndex === 0 && !!el.value && !/^\s*(select|choose|--|please)/i.test(textOf(el.options[0])));
    } else if (base.widget === 'checkbox' || base.widget === 'listbutton') {
      base.filled = false;
    } else {
      base.filled = el.type === 'file' ? !!(el.files && el.files.length) : String(el.value || '').trim() !== '';
    }
    return base;
  }

  function markTarget(it) {
    if (it.radio) return it.inputs[0].closest('fieldset, [role="radiogroup"]') || it.inputs[0].parentElement;
    const el = it.el;
    if (el.type === 'file' && !W.isVisible(el)) return el.closest('label, [class*="upload" i], [data-automation-id*="upload" i], div') || el;
    if (el.type === 'checkbox') return el.closest('label') || el;
    return el;
  }

  // ---------- colours, badges and the status bar ----------

  function style() {
    if (document.getElementById('nm7-style')) return;
    const s = document.createElement('style');
    s.id = 'nm7-style';
    s.textContent = Object.entries(COLOURS).map(([k, c]) => `[data-nm7-mark="${k}"]{outline:3px ${k === 'draft' ? 'dashed' : 'solid'} ${c}!important;outline-offset:2px!important}`).join('')
      + '#nm7-marks{position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none}'
      + '#nm7-marks .nm7-badge{position:absolute;font:600 11px/1.3 system-ui,sans-serif;color:#fff;padding:1px 6px;border-radius:6px;white-space:nowrap}'
      + '#nm7-marks .nm7-chip{position:absolute;pointer-events:auto;display:flex;gap:6px;flex-wrap:wrap;align-items:center;background:#fff;color:#111827;border:2px solid #6d28d9;border-radius:8px;padding:6px 8px;font:13px/1.3 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.18);max-width:420px}'
      + '#nm7-marks .nm7-chip button,#nm7-status button{font:inherit;font-weight:600;border-radius:6px;border:1px solid #111827;background:#fff;color:#111827;padding:6px 10px;min-height:32px;cursor:pointer}'
      + '#nm7-status{position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:min(560px,calc(100vw - 24px));background:#111827;color:#fff;font:14px/1.35 system-ui,sans-serif;padding:8px 10px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.25);display:flex;gap:8px;align-items:center;flex-wrap:wrap}'
      + '#nm7-status .nm7-count{background:transparent;color:#fff;border-color:#fff}';
    (document.head || document.documentElement).appendChild(s);
  }

  function layer() {
    let l = document.getElementById('nm7-marks');
    if (!l) {
      l = document.createElement('div');
      l.id = 'nm7-marks';
      l.setAttribute('aria-hidden', 'false');
      document.documentElement.appendChild(l);
      addEventListener('scroll', place, { passive: true, capture: true });
      addEventListener('resize', place, { passive: true });
    }
    return l;
  }

  let placing = 0;
  function place() {
    if (placing) return;
    placing = setTimeout(() => {
      placing = 0;
      for (const [el, m] of S.marks) {
        const r = el.getBoundingClientRect();
        const top = r.top + (globalThis.scrollY || 0);
        const left = r.left + (globalThis.scrollX || 0);
        m.badge.style.top = `${Math.max(0, top - 16)}px`;
        m.badge.style.left = `${Math.max(0, left + Math.max(0, r.width - 120))}px`;
        if (m.chip) { m.chip.style.top = `${top + r.height + 6}px`; m.chip.style.left = `${Math.max(4, left)}px`; }
      }
    }, 16);
  }

  function mark(target, state, label, el) {
    if (!target) return;
    style();
    const old = S.marks.get(target);
    if (old) { old.badge.remove(); if (old.chip) old.chip.remove(); }
    target.setAttribute('data-nm7-mark', state);
    const b = document.createElement('span');
    b.className = 'nm7-badge';
    b.textContent = BADGE[state];
    b.style.background = COLOURS[state];
    layer().appendChild(b);
    S.marks.set(target, { state, label: label || '', badge: b, el: el || target, chip: null });
    place();
  }

  function clearMarks() {
    for (const [t, m] of S.marks) { t.removeAttribute('data-nm7-mark'); m.badge.remove(); if (m.chip) m.chip.remove(); }
    S.marks.clear();
    const l = document.getElementById('nm7-marks');
    if (l) l.remove();
    const st = document.getElementById('nm7-status');
    if (st) st.remove();
  }

  function counts() {
    const c = { sure: 0, check: 0, left: 0, draft: 0 };
    for (const m of S.marks.values()) c[m.state] += 1;
    return c;
  }

  function summary() {
    const c = counts();
    const parts = [`${c.sure} filled`, `${c.check} to check`, `${c.left} for you`];
    if (c.draft) parts.push(`${c.draft} draft${c.draft === 1 ? '' : 's'} to approve`);
    return parts.join(', ');
  }

  // the next field to look at: drafts and yellow first, then red, in page order, after the one focused now
  let cursor = -1;
  function jumpNext() {
    const list = [...S.marks.values()].filter((m) => m.state !== 'sure');
    const order = [...list.filter((m) => m.state === 'draft' || m.state === 'check'), ...list.filter((m) => m.state === 'left')];
    if (!order.length) return;
    cursor = (cursor + 1) % order.length;
    const m = order[cursor];
    try { m.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* old page */ }
    const focusable = m.el.matches && m.el.matches('input, select, textarea') ? m.el : m.el.querySelector && m.el.querySelector('input, select, textarea');
    if (focusable) { try { focusable.focus({ preventScroll: true }); } catch { /* not focusable */ } }
  }

  function button(label, fn, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', fn);
    return b;
  }

  function statusBar() {
    if (!S.marks.size && !S.offered && !S.note) return;
    style();
    let el = document.getElementById('nm7-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'nm7-status';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.documentElement.appendChild(el);
    }
    el.textContent = '';
    if (S.offered) {
      const t = document.createElement('span');
      t.textContent = 'A new step loaded. Fill it from your Nm7 kit?';
      el.append(t, button('Fill this step', () => { S.offered = ''; fillPage(true); }), button('Not now', () => { S.steps.add(S.offered); S.offered = ''; statusBar(); }));
      return;
    }
    if (S.marks.size) {
      const go = button(summary(), jumpNext, 'nm7-count');
      go.setAttribute('aria-label', `${summary()}. Go to the next field to check.`);
      el.appendChild(go);
      if (S.questions.length && S.kit) el.appendChild(button(`Draft ${Math.min(S.questions.length, 5)} answer${S.questions.length === 1 ? '' : 's'}`, () => draftAll()));
      if (S.touched.size) el.appendChild(button('Undo', undo));
      el.appendChild(button('Hide colours', clearMarks));
    }
    if (S.note) {
      const n = document.createElement('span');
      n.textContent = S.note;
      n.style.flex = '1 1 100%';
      el.appendChild(n);
    }
  }

  // ---------- filling ----------

  function remember(el) {
    if (!S.touched.has(el)) S.touched.set(el, W.snapshot(el));
  }

  async function put(step, it, f, adapter) {
    const el = it.radio ? it.inputs[step.option] : it.el;
    switch (step.widget) {
      case 'file':
        if (!S.pdf || !S.pdf.base64) return null;
        remember(el);
        return W.attach(el, S.pdf) ? 'sure' : null;
      case 'select':
        remember(el);
        return W.selectOption(el, step.option) ? (step.sure ? 'sure' : 'check') : null;
      case 'radio':
        for (const r of it.inputs) remember(r);
        return W.tickChoice(el, true) ? (step.sure ? 'sure' : 'check') : null;
      case 'checkbox':
        remember(el);
        return W.tickChoice(el, true) ? (step.sure ? 'sure' : 'check') : null;
      case 'combobox': {
        remember(el);
        const r = await W.typeAndPick(el, String(step.value), adapter, MAP.matchOption);
        if (!r.typed) return null;
        return r.picked && r.exact && step.sure !== false ? 'sure' : 'check';
      }
      default:
        remember(el);
        W.setValue(el, String(step.value));
        return step.sure ? 'sure' : 'check';
    }
  }

  function loginPage(fields, adapter) {
    const pw = fields.filter((f) => f.type === 'password' && !f.inCaptcha);
    if (!pw.length) return false;
    const others = fields.filter((f) => f.type !== 'password' && ['text', 'combobox', 'textarea', 'date'].includes(f.widget));
    let marked = false;
    try { marked = !!(adapter && adapter.login && document.querySelector(adapter.login)); } catch { marked = false; }
    return marked || others.length <= 4;
  }

  function stepKey(adapter, fields) {
    let head = '';
    try { head = textOf(adapter && adapter.step ? document.querySelector(adapter.step) : document.querySelector('h1, h2')); } catch { head = ''; }
    return `${head}|${fields.filter((f) => !f.filled).map((f) => f.name || f.id || f.label || f.question).sort().join(',')}`;
  }

  async function fillPage(fromPrompt) {
    if (S.busy) return null;
    S.busy = true;
    try {
      const { adapter, items, fields } = collect();
      if (loginPage(fields, adapter)) return { login: true };
      const plan = MAP.planFill(fields, S.kit, location.hostname, adapter && adapter.name);
      let filled = 0;
      let attached = false;
      for (const step of plan.fill) {
        const it = items[step.index];
        const got = await put(step, it, fields[step.index], adapter);
        const label = fields[step.index].question || fields[step.index].label;
        if (got) {
          if (step.widget === 'file') attached = true;
          else filled += 1;
          mark(markTarget(it), got, label, it.radio ? it.inputs[0] : it.el);
        } else {
          mark(markTarget(it), 'left', label, it.radio ? it.inputs[0] : it.el);
        }
      }
      S.questions = [];
      for (const s of plan.skip) {
        if (MAP.QUIET.has(s.why)) continue;
        const it = items[s.index];
        const el = it.radio ? it.inputs[0] : it.el;
        if (s.why === 'locked' || s.why === 'not_in_kit' && fields[s.index].filled) continue;
        mark(markTarget(it), 'left', fields[s.index].question || fields[s.index].label, el);
        if (s.why === 'question' && !it.radio) S.questions.push({ el, question: (fields[s.index].question || fields[s.index].label).slice(0, 300) });
      }
      const key = stepKey(adapter, collect().fields);
      S.steps.add(key);
      S.offered = '';
      const more = [];
      if (plan.more.work) more.push(`${plan.more.work} more job${plan.more.work === 1 ? '' : 's'}`);
      if (plan.more.education) more.push(`${plan.more.education} more education entr${plan.more.education === 1 ? 'y' : 'ies'}`);
      S.note = more.length && (plan.blocks.work || plan.blocks.education)
        ? `Your kit has ${more.join(' and ')}. Press the page's own "Add" button for each, then tap Fill this step.` : '';
      statusBar();
      watch(adapter);
      clearTimeout(S.clearTimer);
      S.clearTimer = setTimeout(clearMarks, CLEAR_AFTER);
      if (fromPrompt) try { chrome.runtime.sendMessage({ type: 'nm7-step', kitId: S.kit.id, step: S.steps.size }); } catch { /* the helper was updated */ }
      const total = plan.fill.length + plan.skip.filter((s) => !MAP.QUIET.has(s.why) && s.why !== 'locked').length;
      const c = counts();
      return {
        filled, attached, total, counts: c,
        list: [...S.marks.values()].map((m) => ({ label: m.label.slice(0, 80), state: m.state })),
        resumeField: plan.fill.some((s) => s.key === 'resume'),
        password: plan.skip.some((s) => s.why === 'password'),
        captcha: plan.skip.some((s) => s.why === 'captcha') || !!document.querySelector(CAPTCHA),
        sensitive: plan.skip.filter((s) => s.why === 'sensitive').length,
        left: c.left,
        questions: S.questions.length,
        more: plan.more,
        misses: MAP.misses(fields, plan),
        site: plan.label || '',
        adapter: plan.site || '',
        step: S.steps.size,
      };
    } finally {
      S.busy = false;
    }
  }

  // ---------- undo ----------

  function undo() {
    for (const [el, before] of S.touched) W.restore(el, before);
    S.touched.clear();
    S.questions = [];
    S.note = 'Undone: the fields are back as they were.';
    clearMarks();
    statusBar();
    setTimeout(() => { S.note = ''; const st = document.getElementById('nm7-status'); if (st && !S.marks.size) st.remove(); }, 4000);
  }

  // ---------- the next step (the candidate pressed the page's own Next) ----------

  function watch(adapter) {
    if (S.observer || typeof MutationObserver === 'undefined') return;
    S.observer = new MutationObserver((list) => {
      if (list.every((m) => m.target && m.target.closest && m.target.closest('[id^="nm7-"]'))) return;
      clearTimeout(S.timer);
      S.timer = setTimeout(() => offerStep(adapter), 700);
    });
    S.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  function offerStep() {
    if (S.busy || !S.kit || S.offered) return;
    const { adapter, fields } = collect();
    const key = stepKey(adapter, fields);
    if (S.steps.has(key) || loginPage(fields, adapter)) return;
    const plan = MAP.planFill(fields, S.kit, location.hostname, adapter && adapter.name);
    if (!plan.fill.length) return;
    // a step the candidate moved to: what was marked on the old step is gone from the page
    for (const [t, m] of S.marks) if (!t.isConnected) { m.badge.remove(); if (m.chip) m.chip.remove(); S.marks.delete(t); }
    S.offered = key;
    statusBar();
  }

  // ---------- smart answers (drafts the candidate approves, edits or discards) ----------

  function chip(el, question) {
    const target = el;
    const m = S.marks.get(target);
    if (!m) return;
    if (m.chip) m.chip.remove();
    const c = document.createElement('div');
    c.className = 'nm7-chip';
    c.setAttribute('role', 'group');
    c.setAttribute('aria-label', 'Draft answer from your Nm7 profile');
    const t = document.createElement('span');
    t.textContent = 'Draft from your Nm7 profile. Use it?';
    const save = (how) => {
      const answer = String(el.value || '').trim();
      if (!answer) return discard();
      S.drafts.delete(el);
      c.remove();
      mark(target, 'sure', question, el);
      statusBar();
      try { chrome.runtime.sendMessage({ type: 'nm7-save-answer', kitId: S.kit.id, question, answer, how }); } catch { /* the helper was updated */ }
    };
    const discard = () => {
      W.restore(el, S.touched.get(el));
      S.touched.delete(el);
      S.drafts.delete(el);
      c.remove();
      mark(target, 'left', question, el);
      statusBar();
    };
    const edit = () => {
      try { el.focus(); } catch { /* not focusable */ }
      t.textContent = 'Change the text in the box, then save it.';
      c.replaceChildren(t, button('Save my answer', () => save('edited')), button('Discard', discard));
    };
    c.append(t, button('Use it', () => save('approved')), button('Edit', edit), button('Discard', discard));
    layer().appendChild(c);
    m.chip = c;
    place();
  }

  async function draftAll() {
    const todo = S.questions.filter((q) => q.el.isConnected && !S.drafts.has(q.el) && !String(q.el.value || '').trim()).slice(0, 5);
    for (const q of todo) {
      const r = await new Promise((resolve) => {
        try { chrome.runtime.sendMessage({ type: 'nm7-draft', kitId: S.kit.id, question: q.question }, (x) => resolve(x || {})); } catch { resolve({}); }
      });
      if (r.paused) { S.note = r.message || 'Smart answers are paused for today, type this one yourself.'; break; }
      if (!r.answer) continue;
      remember(q.el);
      W.setValue(q.el, String(r.answer));
      S.drafts.set(q.el, q.question);
      mark(q.el, 'draft', q.question, q.el);
      chip(q.el, q.question);
    }
    S.questions = S.questions.filter((q) => !S.drafts.has(q.el) && !String(q.el.value || '').trim());
    statusBar();
    return { drafted: S.drafts.size, paused: !!S.note && /paused/.test(S.note) };
  }

  // ---------- after the candidate presses Submit ----------

  function bar(textValue, withButton) {
    let el = document.getElementById('nm7-helper-bar');
    if (!el) {
      el = document.createElement('div');
      el.id = 'nm7-helper-bar';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;max-width:520px;margin:0 auto;'
        + 'background:#111827;color:#fff;font:15px/1.4 system-ui,sans-serif;padding:12px 14px;border-radius:12px;'
        + 'box-shadow:0 6px 24px rgba(0,0,0,.25);display:flex;gap:10px;align-items:center;flex-wrap:wrap';
      document.documentElement.appendChild(el);
    }
    el.textContent = '';
    const span = document.createElement('span');
    span.textContent = textValue;
    span.style.flex = '1 1 200px';
    el.appendChild(span);
    if (withButton) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Mark as applied on Nm7';
      b.style.cssText = 'background:#fff;color:#111827;border:0;border-radius:8px;padding:10px 14px;font:inherit;font-weight:600;min-height:44px';
      b.addEventListener('click', () => {
        b.disabled = true;
        chrome.runtime.sendMessage({ type: 'nm7-mark-applied', kitId: S.kit && S.kit.id }, (r) => {
          if (r && r.ok && r.askRating && r.storeUrl) return rating(r.storeUrl);
          bar(r && r.ok ? 'Marked as applied on Nm7. Good luck!' : (r && r.error) || 'Couldn’t reach Nm7. Use “I applied” on nm7.si instead.', false);
        });
      });
      el.appendChild(b);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.style.cssText = 'background:transparent;color:#fff;border:0;font-size:22px;min-width:44px;min-height:44px';
    close.addEventListener('click', () => el.remove());
    el.appendChild(close);
    return el;
  }

  // once ever, after a fill and Mark as applied (the service worker keeps the "asked" flag)
  function rating(url) {
    const el = bar('Marked as applied on Nm7. Good luck! Did the helper save you time? A rating helps others find it.', false);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'Rate it on the Chrome Web Store';
    a.style.cssText = 'color:#fff;font-weight:600;text-decoration:underline';
    el.insertBefore(a, el.lastChild);
  }

  // The company's form was sent by the candidate (they pressed Submit). Only listened to: nothing is stopped or changed.
  document.addEventListener('submit', () => {
    if (!S.kit) return;
    clearMarks();
    S.offered = '';
    chrome.runtime.sendMessage({ type: 'nm7-submitted', kitId: S.kit.id });
    bar(`Sent your application for ${(S.kit.job && S.kit.job.title) || 'this job'}? Tell Nm7 so your tracker is right.`, true);
  }, { capture: true, passive: true });

  // ---------- entry points (called by the helper's popup through chrome.scripting) ----------

  function crossFrames() {
    if (globalThis.top !== globalThis.self) return [];
    return Array.from(document.querySelectorAll('iframe[src]')).map((f) => {
      let u;
      try { u = new URL(f.src, location.href); } catch { return null; }
      if (!/^https?:$/.test(u.protocol) || u.origin === location.origin) return null;
      const r = f.getBoundingClientRect();
      const big = r.width >= 200 && r.height >= 150;
      return big || HOSTED_FRAME.test(u.hostname) ? { origin: u.origin, host: u.hostname, src: u.href } : null;
    }).filter(Boolean);
  }

  globalThis.Nm7Fill = async function (kit, pdf) {
    const top = globalThis.top === globalThis.self;
    if (BLOCK.isBlocked(location.hostname)) return { blocked: true, top, host: location.hostname };
    S.kit = kit;
    S.pdf = pdf || null;
    const r = (await fillPage(false)) || { busy: true };
    return { ...r, top, host: location.hostname, frames: crossFrames() };
  };

  globalThis.Nm7Draft = draftAll;
  globalThis.Nm7Undo = function () { const n = S.touched.size; undo(); return { undone: n }; };
  globalThis.Nm7State = function () {
    return { counts: counts(), questions: S.questions.length, offered: !!S.offered, touched: S.touched.size, host: location.hostname };
  };
})();
