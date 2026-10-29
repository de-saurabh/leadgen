import { describe, expect, it } from 'vitest';
import { roleCan } from './permissions.js';

describe('business role permissions', () => {
  it('owner can set up campaigns, resources and settings', () => {
    expect(roleCan('owner', { campaign: ['create', 'publish'] })).toBe(true);
    expect(roleCan('owner', { resource: ['update'] })).toBe(true);
    expect(roleCan('owner', { settings: ['update'] })).toBe(true);
    expect(roleCan('owner', { member: ['create'] })).toBe(true);
  });

  it('manager operates leads, bookings and inbox but cannot change setup', () => {
    expect(roleCan('manager', { lead: ['read', 'update'] })).toBe(true);
    expect(roleCan('manager', { booking: ['update'] })).toBe(true);
    expect(roleCan('manager', { inbox: ['reply'] })).toBe(true);
    expect(roleCan('manager', { analytics: ['read'] })).toBe(true);
    expect(roleCan('manager', { campaign: ['read'] })).toBe(true);
    expect(roleCan('manager', { campaign: ['update'] })).toBe(false);
    expect(roleCan('manager', { campaign: ['publish'] })).toBe(false);
    expect(roleCan('manager', { resource: ['create'] })).toBe(false);
    expect(roleCan('manager', { settings: ['update'] })).toBe(false);
    expect(roleCan('manager', { member: ['create'] })).toBe(false);
  });

  it('member only touches bookings', () => {
    expect(roleCan('member', { booking: ['read', 'update'] })).toBe(true);
    expect(roleCan('member', { lead: ['read'] })).toBe(false);
    expect(roleCan('member', { inbox: ['read'] })).toBe(false);
    expect(roleCan('member', { analytics: ['read'] })).toBe(false);
    expect(roleCan('member', { campaign: ['read'] })).toBe(false);
  });
});
