// The one phone box for the whole site (sign-up, profile, company sign-up, the resume, the Easy dashboard, ...): a
// fixed +91 outside the box, digits only with a space after the 5th ("98765 43210"), at most 10 digits; a pasted
// "+91 98765-43210", "09876543210" or "919876543210" becomes "98765 43210". The message "Enter a 10-digit mobile
// number" shows only after leaving the box (or when the form passes `error`); an empty optional box is never an
// error. The label is a real <label>; the +91 is part of the box's description, not its name.
// onChange gets the box's text ("98765 43210"); send toE164(value) (lib/phone.js) to the server.
import { useLayoutEffect, useRef, useState } from 'react';
import { useLang } from '../lib/i18n';
import { maskPhone, phoneIssue } from '../lib/phone';

export default function PhoneInput({
  id, label, value, onChange, required = false, error = '', hint, testid, onBlur, describedBy, autoComplete = 'tel-national',
  fieldClass = 'field', labelClass = 'label', inputClass = 'input', msgClass, style, inputStyle, disabled,
}) {
  const [t] = useLang();
  const [left, setLeft] = useState(false); // the person has left the box once
  const caret = useRef(null);
  const box = useRef(null);
  const shown = maskPhone(value);
  useLayoutEffect(() => {
    // keep the caret after the same digit when the space moves (typing or deleting in the middle)
    const el = box.current;
    if (caret.current == null || !el || document.activeElement !== el) return;
    let n = caret.current; let at = 0;
    while (at < shown.length && n > 0) { if (/\d/.test(shown[at])) n -= 1; at += 1; }
    el.setSelectionRange(at, at);
    caret.current = null;
  });
  const issue = left ? phoneIssue(value, required) : '';
  const msg = error || (issue && t('phone.err'));
  const help = hint === undefined ? t('phone.hint') : hint;
  const describe = [`${id}-cc`, (msg || help) && `${id}-m`, describedBy].filter(Boolean).join(' ');
  return (
    <div className={fieldClass} style={style}>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <div className="phone-box">
        <span id={`${id}-cc`} className="phone-cc" aria-hidden="true">+91</span>
        <input
          ref={box} id={id} className={`${inputClass} phone-in`} style={inputStyle} type="tel" inputMode="tel" autoComplete={autoComplete}
          placeholder="XXXXX XXXXX" value={shown} required={required || undefined} disabled={disabled}
          aria-invalid={msg ? 'true' : undefined} aria-describedby={describe} data-testid={testid}
          onChange={(e) => {
            const el = e.target;
            caret.current = el.value.slice(0, el.selectionStart ?? el.value.length).replace(/\D/g, '').length;
            const next = maskPhone(el.value);
            // a pasted number with +91 / 0 in front: the caret goes to the end
            if (next.replace(/\D/g, '').length < el.value.replace(/\D/g, '').length) caret.current = 10;
            onChange(next);
          }}
          onBlur={(e) => { setLeft(true); onBlur?.(e); }}
        />
      </div>
      {(msg || help) && <span id={`${id}-m`} className={msgClass || (msg ? 'error' : 'help')} role={msg ? 'alert' : undefined}>{msg || help}</span>}
    </div>
  );
}
