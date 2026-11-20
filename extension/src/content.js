// Nm7 Apply helper, in the company's apply page. Injected only when the candidate taps "Fill this page" in the helper
// (activeTab), never on its own and never on a job board.
//
// It types the candidate's own kit values into empty fields, attaches the tailored resume PDF to the resume upload
// where the page allows it, and then STOPS. It never presses the company's Submit button or any other button, never
// sends the form, never touches a CAPTCHA, never fills a password and never creates an account. The candidate checks
// everything and presses Submit. When they do, it offers "Mark as applied on Nm7" (a small bar on the page and the
// helper's badge); it does not stop or change the company's own submit in any way.
(function () {
  if (globalThis.Nm7Fill) return;
  const MAP = globalThis.Nm7FieldMap;
  const BLOCK = globalThis.Nm7Blocklist;
  const CAPTCHA = '[class*="captcha" i],[id*="captcha" i],[name*="captcha" i],.g-recaptcha,.h-captcha,.cf-turnstile,[data-sitekey]';
  const HOSTED_FRAME = /(greenhouse\.io|lever\.co|myworkdayjobs\.com|smartrecruiters\.com|ashbyhq\.com|workable\.com)/i;
  let current = null; // the kit filled on this page: { id, title }

  function labelOf(el) {
    const parts = [];
    if (el.labels) for (const l of el.labels) parts.push(l.textContent);
    const by = el.getAttribute('aria-labelledby');
    if (by) for (const id of by.split(/\s+/)) { const n = document.getElementById(id); if (n) parts.push(n.textContent); }
    if (!parts.length) {
      const wrap = el.closest('label, .field, .form-group, .application-question, [class*="field" i], li, p, div');
      if (wrap) {
        const lab = wrap.querySelector('label, legend, .label, [class*="label" i]');
        if (lab && !lab.contains(el)) parts.push(lab.textContent);
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  function visible(el) {
    if (el.type === 'file') return true; // upload inputs are often hidden behind a styled button
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  function controls() {
    return Array.from(document.querySelectorAll('input, textarea, select')).filter(visible);
  }

  function describe(el) {
    return {
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute('type') || (el.tagName === 'TEXTAREA' ? 'textarea' : 'text')).toLowerCase(),
      name: el.getAttribute('name') || '',
      id: el.id || '',
      label: labelOf(el),
      placeholder: el.getAttribute('placeholder') || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      aria: el.getAttribute('aria-label') || '',
      automationId: el.getAttribute('data-automation-id') || '',
      inCaptcha: !!el.closest(CAPTCHA),
      disabled: !!el.disabled,
      readOnly: !!el.readOnly,
      filled: el.type === 'file' ? !!(el.files && el.files.length) : String(el.value || '').trim() !== '',
    };
  }

  // set the value the way a person typing would, so the page's own scripts see it
  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus({ preventScroll: true });
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }

  function attach(el, pdf) {
    try {
      const bytes = Uint8Array.from(atob(pdf.base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], pdf.name || 'Resume.pdf', { type: 'application/pdf' });
      const dt = new DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.files && el.files.length === 1;
    } catch {
      return false;
    }
  }

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
        chrome.runtime.sendMessage({ type: 'nm7-mark-applied', kitId: current && current.id }, (r) => {
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
  }

  // The company's form was sent by the candidate (they pressed Submit). Only listened to: nothing is stopped or changed.
  document.addEventListener('submit', () => {
    if (!current) return;
    chrome.runtime.sendMessage({ type: 'nm7-submitted', kitId: current.id });
    bar(`Sent your application for ${current.title}? Tell Nm7 so your tracker is right.`, true);
  }, { capture: true, passive: true });

  globalThis.Nm7Fill = function (kit, pdf) {
    if (BLOCK.isBlocked(location.hostname)) return { blocked: true };
    current = { id: kit.id, title: (kit.job && kit.job.title) || 'this job' };
    const els = controls();
    const plan = MAP.planFill(els.map(describe), kit, location.hostname);
    let filled = 0;
    let attached = false;
    for (const step of plan.fill) {
      const el = els[step.index];
      if (step.key === 'resume') {
        if (!attached && pdf && pdf.base64) attached = attach(el, pdf);
      } else {
        setValue(el, step.value);
        filled += 1;
      }
    }
    const frames = Array.from(document.querySelectorAll('iframe[src]')).map((f) => f.src).filter((s) => HOSTED_FRAME.test(s));
    return {
      filled,
      attached,
      resumeField: plan.fill.some((s) => s.key === 'resume'),
      password: plan.skip.some((s) => s.why === 'password'),
      captcha: plan.skip.some((s) => s.why === 'captcha') || !!document.querySelector(CAPTCHA),
      sensitive: plan.skip.filter((s) => s.why === 'sensitive').length,
      left: plan.skip.filter((s) => ['unknown', 'not_in_kit', 'choice', 'other_file'].includes(s.why)).length,
      frame: frames[0] || '',
      site: plan.site,
    };
  };
})();
