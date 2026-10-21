import { describe, expect, it } from 'vitest';
import { draftLooksMine } from './customerStore';

describe('draftLooksMine: a guest draft is taken as this person’s only when it clearly is', () => {
  const acc = { name: 'Meera Nair', email: 'meera@example.com' };
  it('no name or email typed → mine', () => { expect(draftLooksMine({ personal: { name: '', email: '' } }, acc)).toBe(true); });
  it('same name (any case/spacing) → mine', () => { expect(draftLooksMine({ personal: { name: ' meera  NAIR ' } }, acc)).toBe(true); });
  it('same email → mine', () => { expect(draftLooksMine({ personal: { name: 'M', email: 'Meera@Example.com' } }, acc)).toBe(true); });
  it('another person’s name → not mine (shared phone)', () => { expect(draftLooksMine({ personal: { name: 'Ravi Kumar', email: '' } }, acc)).toBe(false); });
});
