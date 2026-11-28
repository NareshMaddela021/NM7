import { describe, expect, it } from 'vitest';
import { isPhone, maskPhone, phoneDigits, phoneIssue, showPhone, toE164 } from './phone';

describe('the phone mask while typing', () => {
  it('digits only, a space after the 5th, at most 10 digits', () => {
    expect(maskPhone('')).toBe('');
    expect(maskPhone('9')).toBe('9');
    expect(maskPhone('98765')).toBe('98765');
    expect(maskPhone('987654')).toBe('98765 4');
    expect(maskPhone('9876543210')).toBe('98765 43210');
    expect(maskPhone('98765432109')).toBe('98765 43210'); // an 11th digit is dropped
    expect(maskPhone('98a76-5x4')).toBe('98765 4');
    expect(maskPhone(null)).toBe('');
  });
  it('a 10-digit number starting with 91 is a number, not a country code', () => {
    expect(maskPhone('9123456789')).toBe('91234 56789');
  });
});

describe('pasted numbers are cleaned to 10 digits', () => {
  for (const raw of ['+91 98765-43210', '09876543210', '919876543210', '+919876543210', '+91 98765 43210', '0091 98765 43210', '(+91) 98765 43210', '98765 43210']) {
    it(raw, () => {
      expect(phoneDigits(raw)).toBe('9876543210');
      expect(maskPhone(raw)).toBe('98765 43210');
      expect(toE164(raw)).toBe('+919876543210');
      expect(showPhone(raw)).toBe('+91 98765 43210');
    });
  }
});

describe('gentle validation', () => {
  it('an Indian mobile: 10 digits starting 6-9', () => {
    expect(isPhone('98765 43210')).toBe(true);
    expect(isPhone('62345 67890')).toBe(true);
    expect(isPhone('58765 43210')).toBe(false);
    expect(isPhone('98765 4321')).toBe(false);
    expect(isPhone('98765432101234')).toBe(false); // too many digits is not silently a number
  });
  it('an empty optional box is fine; an empty required box is not', () => {
    expect(phoneIssue('')).toBe('');
    expect(phoneIssue('   ')).toBe('');
    expect(phoneIssue('', true)).toBe('empty');
    expect(phoneIssue('98765')).toBe('invalid');
    expect(phoneIssue('98765 43210', true)).toBe('');
  });
  it('what is sent and what is shown', () => {
    expect(toE164('')).toBe('');
    expect(toE164('98765')).toBe('98765'); // the server says what is wrong
    expect(showPhone('')).toBe('');
    expect(showPhone('+1 415 555 0100')).toBe('+1 415 555 0100'); // not an Indian mobile: as it was
  });
});
