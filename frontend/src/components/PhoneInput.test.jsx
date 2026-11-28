// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import PhoneInput from './PhoneInput';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root; let host; let last;

function Form({ required = false, start = '' }) {
  const [v, setV] = useState(start);
  last = v;
  return createElement(PhoneInput, { id: 'ph', label: 'Mobile (WhatsApp)', value: v, onChange: setV, required });
}
const box = () => host.querySelector('#ph');
const msg = () => host.querySelector('#ph-m');
function type(text) {
  const el = box();
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
  act(() => { set.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })); });
}
const leave = () => act(() => { box().focus(); box().blur(); box().dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });

beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('PhoneInput', () => {
  it('a real label, +91 outside the box, the right keyboard and autofill, the mask placeholder', () => {
    act(() => root.render(createElement(Form)));
    const el = box();
    expect(host.querySelector('label[for="ph"]').textContent).toBe('Mobile (WhatsApp)');
    expect(el.getAttribute('type')).toBe('tel');
    expect(el.getAttribute('inputmode')).toBe('tel');
    expect(el.getAttribute('autocomplete')).toBe('tel-national');
    expect(el.getAttribute('placeholder')).toBe('XXXXX XXXXX');
    const cc = host.querySelector('#ph-cc');
    expect(cc.textContent).toBe('+91');
    expect(cc.getAttribute('aria-hidden')).toBe('true');
    expect(el.getAttribute('aria-describedby').split(' ')).toContain('ph-cc');
  });
  it('masks while typing and cleans a pasted number', () => {
    act(() => root.render(createElement(Form)));
    type('987654');
    expect(box().value).toBe('98765 4');
    type('98765 432109');
    expect(box().value).toBe('98765 43210');
    type('+91 98765-43210');
    expect(box().value).toBe('98765 43210');
    type('09876543210');
    expect(box().value).toBe('98765 43210');
    type('919876543210');
    expect(box().value).toBe('98765 43210');
    expect(last).toBe('98765 43210');
  });
  it('shows a stored E.164 number in the box', () => {
    act(() => root.render(createElement(Form, { start: '+919876543210' })));
    expect(box().value).toBe('98765 43210');
  });
  it('the message shows only after leaving the box', () => {
    act(() => root.render(createElement(Form)));
    type('98765');
    expect(box().getAttribute('aria-invalid')).toBeNull();
    expect(msg().textContent).not.toBe('Enter a 10-digit mobile number');
    leave();
    expect(msg().textContent).toBe('Enter a 10-digit mobile number');
    expect(box().getAttribute('aria-invalid')).toBe('true');
    type('98765 43210');
    expect(box().getAttribute('aria-invalid')).toBeNull();
  });
  it('an empty optional box is never an error; a required one is', () => {
    act(() => root.render(createElement(Form)));
    leave();
    expect(box().getAttribute('aria-invalid')).toBeNull();
    act(() => root.render(createElement(Form, { required: true })));
    leave();
    expect(msg().textContent).toBe('Enter a 10-digit mobile number');
  });
});
