import { describe, expect, it } from 'vitest';
import { joinLink, signupAccount } from './signupRoles';

describe('Create free account links', () => {
  it('sends companies and colleges to their own sign-up flows', () => {
    expect(joinLink('company')).toBe('/for-companies');
    expect(joinLink('college')).toBe('/for-orgs?start=1#start');
  });
  it('sends job seekers and students to /signup with the role in the link', () => {
    expect(joinLink('seeker')).toBe('/signup?role=jobseeker');
    expect(joinLink('jobseeker')).toBe('/signup?role=jobseeker');
    expect(joinLink('student')).toBe('/signup?role=student');
    expect(joinLink('expert')).toBe('/signup?role=expert');
  });
  it('falls back to plain /signup', () => {
    expect(joinLink()).toBe('/signup');
    expect(joinLink('admin')).toBe('/signup');
  });
});

describe('sign-up role preselect', () => {
  it('maps job seekers and students to a customer account, experts to an expert account', () => {
    expect(signupAccount('jobseeker')).toBe('customer');
    expect(signupAccount('student')).toBe('customer');
    expect(signupAccount('Expert ')).toBe('expert');
  });
  it('keeps the older ?as=expert and defaults to customer', () => {
    expect(signupAccount(null, 'expert')).toBe('expert');
    expect(signupAccount('student', 'expert')).toBe('customer');
    expect(signupAccount()).toBe('customer');
    expect(signupAccount('admin')).toBe('customer');
  });
});
