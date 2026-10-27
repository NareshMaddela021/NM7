import { afterEach, describe, expect, it } from 'vitest';
import {
  blankForm, bodyOf, bulkCsv, bulkFileName, forgetCode, formOf, normCode, priceText, rememberCode, rs, savedCode,
  toCsv, toggleItem, usesText,
} from './codes';

// node has no sessionStorage: a small one for the ?code= test
const store = new Map();
globalThis.sessionStorage ??= { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

describe('codes', () => {
  afterEach(() => forgetCode());

  it('normalises like the server', () => {
    expect(normCode(' save 50 ')).toBe('SAVE50');
    expect(normCode(null)).toBe('');
  });

  it('prices and uses read plainly', () => {
    expect(rs(99_00)).toBe('99');
    expect(rs(74_50)).toBe('74.50');
    expect(priceText({ code: 'SAVE50', original: 99_00, final: 49_00 })).toBe('Rs 99 -> Rs 49 with SAVE50');
    expect(priceText({ code: 'FREE', original: 99_00, final: 0 })).toBe('Code applied - unlocked');
    expect(usesText({ uses: 37, totalLimit: 100 })).toBe('37 / 100');
    expect(usesText({ uses: 4, totalLimit: null })).toBe('4 / unlimited');
  });

  it('turns the form into the API body and catches mistakes', () => {
    const f = { ...blankForm(), type: 'flat', value: '50', items: ['resume'], unlimited: false, totalLimit: '100', validUntil: '2026-12-31' };
    expect(bodyOf(f)).toEqual({ type: 'flat', value: 5000, items: ['resume'], totalLimit: 100, perLimit: 1, validFrom: null, validUntil: '2026-12-31', only: null, note: '' });
    expect(bodyOf({ ...f, type: 'percent', value: '100' }).error).toMatch(/1 to 99/);
    expect(bodyOf({ ...f, type: 'free', value: '' }).value).toBe(0);
    expect(bodyOf({ ...f, items: [] }).error).toMatch(/applies to/);
    expect(bodyOf({ ...f, totalLimit: '' }).error).toMatch(/total uses/);
    expect(bodyOf({ ...f, validFrom: '2027-01-01' }).error).toMatch(/before/);
    expect(bodyOf({ ...f, onlyKind: 'org' }).error).toMatch(/organization or group/);
    expect(bodyOf({ ...f, onlyKind: 'group', onlyId: 'g1' }).only).toEqual({ kind: 'group', id: 'g1' });
  });

  it('round-trips a row into the edit form', () => {
    const row = { code: 'X1', type: 'flat', value: 5000, items: ['resume'], totalLimit: null, perLimit: 2, validFrom: null, validUntil: '2026-12-31', only: { kind: 'org', id: 'o1', name: 'A' }, note: 'n' };
    const f = formOf(row);
    expect(f.value).toBe('50');
    expect(bodyOf(f)).toMatchObject({ value: 5000, totalLimit: null, perLimit: 2, only: { kind: 'org', id: 'o1' } });
  });

  it('All and single items exclude each other', () => {
    expect(toggleItem(['all'], 'resume')).toEqual(['resume']);
    expect(toggleItem(['resume'], 'all')).toEqual(['all']);
    expect(toggleItem(['resume', 'drive'], 'resume')).toEqual(['drive']);
  });

  it('makes safe CSV files', () => {
    expect(toCsv([['a', '=SUM(1)', 'x,y']])).toBe('﻿a,\'=SUM(1),"x,y"\r\n');
    expect(bulkCsv(['DRIVE-7KQ2', 'DRIVE-AB3C']).split('\r\n').slice(0, 3)).toEqual(['﻿Code,Type,Note', 'DRIVE-7KQ2,,', 'DRIVE-AB3C,,']);
    expect(bulkFileName('DRIVE')).toBe('Nm7_codes_DRIVE.csv');
  });

  it('keeps a ?code= until the pay step and ignores junk', () => {
    expect(rememberCode('?code=campus26')).toBe('CAMPUS26');
    expect(savedCode()).toBe('CAMPUS26');
    expect(rememberCode('?code=<x>')).toBe('');
    expect(savedCode()).toBe('CAMPUS26');
    forgetCode();
    expect(savedCode()).toBe('');
  });
});
