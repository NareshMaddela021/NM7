// Nm7 Apply helper: how a value goes into each kind of form control, the way a person typing or choosing would, so
// the page's own scripts see it. Text boxes, text areas, drop-down lists (by the option's text), radio buttons and
// check boxes (only what fieldmap.js says the kit backs), dates, type-to-search lists (type, wait for the list, pick
// the best match or leave it yellow) and the resume upload (DataTransfer).
//
// What it never does: press Enter, press a button, submit a form, follow a link. The only two places that send a
// mouse event are pickOption (an item of a list box the helper itself just opened by typing) and tickChoice (a
// radio button or check box), and both refuse anything that is or sits inside a button, a link or a submit control.
// The test "never submits" checks that no other code in the page scripts sends any click.
(function () {
  if (globalThis.Nm7Widgets) return;
  const PRESSABLE = 'button, a[href], input[type="submit"], input[type="button"], input[type="image"], input[type="reset"], [role="button"], [role="link"], [role="menuitem"], summary';
  const ACTION_WORDS = /^(submit|next|continue|apply( now)?|save( and continue)?|save|sign in|log in|login|register|create account|send|finish|review|back|previous|add( another)?|remove|delete|upload)$/i;

  function proto(el) {
    if (el.tagName === 'TEXTAREA') return HTMLTextAreaElement.prototype;
    if (el.tagName === 'SELECT') return HTMLSelectElement.prototype;
    return HTMLInputElement.prototype;
  }

  function fire(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  }

  function setNative(el, prop, value) {
    const d = Object.getOwnPropertyDescriptor(proto(el), prop);
    if (d && d.set) d.set.call(el, value);
    else el[prop] = value;
  }

  // what the field held before the helper touched it (Undo puts it back)
  function snapshot(el) {
    if (el.type === 'checkbox' || el.type === 'radio') return { checked: !!el.checked };
    if (el.type === 'file') return { files: el.files && el.files.length ? el.files : null };
    return { value: el.value };
  }

  function setValue(el, value, keepFocus) {
    try { el.focus({ preventScroll: true }); } catch { /* not focusable */ }
    setNative(el, 'value', value);
    fire(el, 'input');
    if (!keepFocus) {
      fire(el, 'change');
      el.blur();
    }
    return String(el.value) === String(value);
  }

  function selectOption(el, index) {
    const opt = el.options[index];
    if (!opt) return false;
    try { el.focus({ preventScroll: true }); } catch { /* not focusable */ }
    setNative(el, 'value', opt.value);
    if (el.selectedIndex !== index) el.selectedIndex = index;
    fire(el, 'input');
    fire(el, 'change');
    el.blur();
    return el.selectedIndex === index;
  }

  function safeTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.matches(PRESSABLE) || (el.closest && el.closest(PRESSABLE))) return false;
    if (el.querySelector && el.querySelector(PRESSABLE)) return false;
    const t = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    return !ACTION_WORDS.test(t);
  }

  // A radio button or check box the kit backs. Pages built with React only notice a choice through its click event,
  // so a click is sent to this one input (never a button, never a link, never inside either); without one, the
  // checked state is set directly.
  function tickChoice(input, on = true) {
    if (!input || input.tagName !== 'INPUT' || !/^(radio|checkbox)$/.test(input.type)) return false;
    if (input.closest(PRESSABLE) || input.disabled) return false;
    if (!!input.checked === on) return true;
    input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: globalThis.window || null }));
    if (!!input.checked !== on) {
      setNative(input, 'checked', on);
      fire(input, 'input');
      fire(input, 'change');
    }
    return !!input.checked === on;
  }

  // An item of the list a type-to-search box showed after the helper typed into it: only an element with the option
  // role (or a list item in a list box), with no button, link or submit control in or around it, and whose text is
  // not an action word.
  function pickOption(opt) {
    if (!opt || opt.nodeType !== 1) return false;
    const role = (opt.getAttribute('role') || '').toLowerCase();
    const listed = role === 'option' || (opt.tagName === 'LI' && !!opt.closest('[role="listbox"]')) || opt.getAttribute('data-automation-id') === 'promptOption';
    if (!listed || !safeTarget(opt)) return false;
    for (const type of ['mousedown', 'mouseup', 'click']) {
      opt.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: globalThis.window || null }));
    }
    return true;
  }

  function isVisible(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden || n.getAttribute('aria-hidden') === 'true') return false;
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
    }
    return true;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // the options a type-to-search box is showing now
  function optionsFor(el, adapter) {
    const doc = el.ownerDocument;
    const ids = `${el.getAttribute('aria-controls') || ''} ${el.getAttribute('aria-owns') || ''}`.trim().split(/\s+/).filter(Boolean);
    let found = [];
    for (const id of ids) {
      const box = doc.getElementById(id);
      if (box) found = found.concat(Array.from(box.querySelectorAll('[role="option"], li')));
    }
    if (!found.length) {
      const sel = (adapter && adapter.options) || '[role="option"]';
      try { found = Array.from(doc.querySelectorAll(sel)); } catch { found = Array.from(doc.querySelectorAll('[role="option"]')); }
    }
    return found.filter((o) => isVisible(o) && !o.closest('[id^="nm7-"]') && String(o.textContent || '').trim());
  }

  // Type the value, wait for the list, pick the best match. → { picked, exact, typed }
  async function typeAndPick(el, value, adapter, match, wait = 1500) {
    if (el.list && el.list.options && el.list.options.length) { // a <datalist>: the value itself is the choice
      const opts = Array.from(el.list.options).map((o) => o.value || o.textContent);
      const m = match(opts, value);
      if (m.index < 0) return { picked: false, typed: false };
      setValue(el, opts[m.index]);
      return { picked: true, exact: m.exact, typed: true };
    }
    setValue(el, value, true);
    let opts = [];
    const until = Date.now() + wait;
    while (Date.now() < until) {
      await sleep(100);
      opts = optionsFor(el, adapter);
      if (opts.length) break;
    }
    if (opts.length) {
      await sleep(60); // let a debounced list settle
      opts = optionsFor(el, adapter);
      const m = match(opts.map((o) => o.textContent.replace(/\s+/g, ' ').trim()), value);
      if (m.index >= 0 && pickOption(opts[m.index])) {
        await sleep(30);
        return { picked: true, exact: m.exact, typed: true };
      }
    }
    fire(el, 'change');
    return { picked: false, typed: true };
  }

  function attach(el, pdf) {
    try {
      const bytes = Uint8Array.from(atob(pdf.base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], pdf.name || 'Resume.pdf', { type: 'application/pdf' });
      const dt = new DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      fire(el, 'input');
      fire(el, 'change');
      return !!(el.files && el.files.length === 1);
    } catch {
      return false;
    }
  }

  // Undo: put back what was there before (the same setters, so the page's scripts see it)
  function restore(el, before) {
    if (!before) return;
    if ('checked' in before) {
      if (!!el.checked !== before.checked) {
        if (el.type === 'checkbox' || before.checked) tickChoice(el, before.checked);
        else { setNative(el, 'checked', false); fire(el, 'change'); }
      }
      return;
    }
    if ('files' in before) {
      try {
        if (before.files) el.files = before.files;
        else { el.value = ''; }
        fire(el, 'change');
      } catch { /* the browser keeps the file */ }
      return;
    }
    if (el.tagName === 'SELECT') {
      setNative(el, 'value', before.value);
      fire(el, 'change');
      return;
    }
    setValue(el, before.value);
  }

  globalThis.Nm7Widgets = { setValue, selectOption, tickChoice, pickOption, typeAndPick, attach, snapshot, restore, optionsFor, isVisible, safeTarget, sleep };
})();
