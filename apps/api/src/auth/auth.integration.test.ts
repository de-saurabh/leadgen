import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../db/schema/index.js';
import { ADMIN } from '../test/constants.js';
import { createTestContext, type TestClient, type TestContext } from '../test/helpers.js';

let ctx: TestContext;
let admin: TestClient;
let clinic: { id: string; ownerPassword: string };

const CLINIC = {
  name: 'City Care Clinic',
  owner: { name: 'Dr. Mehta', email: 'owner@citycare.test' },
};

/** Adds a staff user to a business directly (team management UI arrives in a later milestone). */
async function addStaff(email: string, role: 'manager' | 'member', organizationId: string) {
  const password = 'staff-test-password';
  const { user } = await ctx.auth.api.signUpEmail({ body: { name: email, email, password } });
  await ctx.auth.api.addMember({ body: { userId: user.id, role, organizationId } });
  return { email, password };
}

beforeAll(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminClient();
  const res = await admin.request('/api/admin/businesses', { json: CLINIC });
  expect(res.status).toBe(201);
  clinic = { id: res.body.business.id, ownerPassword: res.body.business.generatedOwnerPassword };
});

afterAll(() => ctx.close());

describe('sign-in and session', () => {
  it('rejects a wrong password', async () => {
    const res = await ctx.client().signIn(ADMIN.email, 'wrong-password');
    expect(res.status).toBe(401);
  });

  it('requires a session for /api/me', async () => {
    const res = await ctx.client().request('/api/me');
    expect(res.status).toBe(401);
  });

  it('lets the platform admin in, outside any business', async () => {
    const me = await admin.request('/api/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      user: { email: ADMIN.email, role: 'admin' },
      isPlatformAdmin: true,
      impersonatedBy: null,
      business: null,
      role: null,
    });
  });

  it('does not allow public sign-up or business creation over HTTP', async () => {
    const client = ctx.client();
    const signUp = await client.request('/api/auth/sign-up/email', {
      json: { name: 'Eve', email: 'eve@test.local', password: 'eve-test-password' },
    });
    expect(signUp.status).toBe(403);

    const owner = ctx.client();
    await owner.signIn(CLINIC.owner.email, clinic.ownerPassword);
    const create = await owner.request('/api/auth/organization/create', {
      json: { name: 'Sneaky', slug: 'sneaky' },
    });
    expect(create.status).toBe(403);
  });
});

it('cannot be bypassed with URL variants of the blocked routes', async () => {
  const client = ctx.client();
  for (const path of [
    '/api/auth/sign-up/email/',
    '/api/auth//sign-up/email',
    '/api/auth/SIGN-UP/EMAIL',
    '/api/auth/sign-up/email?x=1',
  ]) {
    const res = await client.request(path, {
      json: { name: 'Mallory', email: 'mallory@test.local', password: 'mallory-test-password' },
    });
    expect(res.status, path).not.toBe(200);
  }
  const created = await ctx.db.query.user.findFirst({
    where: eq(schema.user.email, 'mallory@test.local'),
  });
  expect(created).toBeUndefined();
});

describe('creating a business', () => {
  it('creates the business and an owner who lands in it', async () => {
    expect(clinic.ownerPassword).toMatch(/\S{8,}/);

    const owner = ctx.client();
    const signIn = await owner.signIn(CLINIC.owner.email, clinic.ownerPassword);
    expect(signIn.status).toBe(200);

    const me = await owner.request('/api/me');
    expect(me.body).toMatchObject({
      user: { email: CLINIC.owner.email, role: 'user' },
      isPlatformAdmin: false,
      role: 'owner',
      business: {
        id: clinic.id,
        name: CLINIC.name,
        slug: 'city-care-clinic',
        timezone: 'Asia/Kolkata',
      },
    });
  });

  it('stores settings for the business', async () => {
    const [settings] = await ctx.db
      .select()
      .from(schema.businessSettings)
      .where(eq(schema.businessSettings.organizationId, clinic.id));
    expect(settings).toMatchObject({
      timezone: 'Asia/Kolkata',
      defaultCountryCode: '91',
      roleLabels: {},
    });
  });

  it('rejects a duplicate slug', async () => {
    const res = await admin.request('/api/admin/businesses', {
      json: { name: 'City Care Clinic', owner: { name: 'Other', email: 'other@test.local' } },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('slug_taken');
  });

  it('validates the request', async () => {
    const res = await admin.request('/api/admin/businesses', {
      json: { name: 'X', owner: { name: 'No Email', email: 'nope' } },
    });
    expect(res.status).toBe(400);
  });

  it('reuses an existing user as owner of a second business', async () => {
    const res = await admin.request('/api/admin/businesses', {
      json: { name: 'Second Clinic', owner: { name: 'Dr. Mehta', email: CLINIC.owner.email } },
    });
    expect(res.status).toBe(201);
    expect(res.body.business.generatedOwnerPassword).toBeUndefined();
  });

  it('lists businesses with member counts for the platform admin', async () => {
    const res = await admin.request('/api/admin/businesses');
    expect(res.status).toBe(200);
    const listed = res.body.businesses.find((b: { id: string }) => b.id === clinic.id);
    expect(listed).toMatchObject({ name: CLINIC.name, memberCount: 1, timezone: 'Asia/Kolkata' });
  });
});

describe('admin API access', () => {
  it('is forbidden to business users and rejects anonymous callers', async () => {
    const owner = ctx.client();
    await owner.signIn(CLINIC.owner.email, clinic.ownerPassword);
    expect((await owner.request('/api/admin/businesses')).status).toBe(403);
    expect((await ctx.client().request('/api/admin/businesses')).status).toBe(401);
  });
});

describe('role scoping inside a business', () => {
  let manager: TestClient;
  let member: TestClient;
  let owner: TestClient;

  beforeAll(async () => {
    owner = ctx.client();
    await owner.signIn(CLINIC.owner.email, clinic.ownerPassword);

    const managerAccount = await addStaff('manager@citycare.test', 'manager', clinic.id);
    manager = ctx.client();
    await manager.signIn(managerAccount.email, managerAccount.password);

    const memberAccount = await addStaff('member@citycare.test', 'member', clinic.id);
    member = ctx.client();
    await member.signIn(memberAccount.email, memberAccount.password);
  });

  it('puts each staff user in their business with their role', async () => {
    expect((await manager.request('/api/me')).body).toMatchObject({
      role: 'manager',
      business: { id: clinic.id },
    });
    expect((await member.request('/api/me')).body).toMatchObject({
      role: 'member',
      business: { id: clinic.id },
    });
  });

  it('lets owner and manager read settings, but not a member', async () => {
    expect((await owner.request('/api/business')).status).toBe(200);
    expect((await manager.request('/api/business')).status).toBe(200);
    expect((await member.request('/api/business')).status).toBe(403);
  });

  it('lets only the owner change settings', async () => {
    const patch = { timezone: 'Asia/Dubai' };
    expect((await member.request('/api/business', { method: 'PATCH', json: patch })).status).toBe(
      403,
    );
    expect((await manager.request('/api/business', { method: 'PATCH', json: patch })).status).toBe(
      403,
    );

    const ok = await owner.request('/api/business', { method: 'PATCH', json: patch });
    expect(ok.status).toBe(200);
    expect(ok.body.business.timezone).toBe('Asia/Dubai');
  });

  it('lets the owner rename role labels, shown back on /api/me', async () => {
    const res = await owner.request('/api/business', {
      method: 'PATCH',
      json: { roleLabels: { manager: 'Receptionist' } },
    });
    expect(res.status).toBe(200);
    expect((await manager.request('/api/me')).body.business.roleLabel).toBe('Receptionist');
    expect((await owner.request('/api/me')).body.business.roleLabel).toBeNull();
  });

  it('rejects invalid settings', async () => {
    const res = await owner.request('/api/business', {
      method: 'PATCH',
      json: { timezone: 'Mars/Olympus' },
    });
    expect(res.status).toBe(400);
  });

  it('does not let a business user see another business', async () => {
    const other = await admin.request('/api/admin/businesses', {
      json: {
        name: 'Neon Pub',
        owner: { name: 'Pub Owner', email: 'owner@neon.test', password: 'neon-owner-password' },
      },
    });
    expect(other.status).toBe(201);

    const pubOwner = ctx.client();
    await pubOwner.signIn('owner@neon.test', 'neon-owner-password');
    const business = await pubOwner.request('/api/business');
    expect(business.body.business.name).toBe('Neon Pub');
    // Settings changes by the clinic owner never touch the pub.
    expect(business.body.business.timezone).toBe('Asia/Kolkata');
  });
});

describe('platform admin impersonation (Better Auth admin plugin)', () => {
  it('lets the admin view the dashboard as the owner and then stop', async () => {
    const owner = await ctx.db.query.user.findFirst({
      where: eq(schema.user.email, CLINIC.owner.email),
    });

    const start = await admin.request('/api/auth/admin/impersonate-user', {
      json: { userId: owner!.id },
    });
    expect(start.status).toBe(200);

    const as = await admin.request('/api/me');
    expect(as.body).toMatchObject({
      user: { email: CLINIC.owner.email },
      isPlatformAdmin: false,
      role: 'owner',
    });
    expect(as.body.impersonatedBy).toEqual(expect.any(String));

    const stop = await admin.request('/api/auth/admin/stop-impersonating', { json: {} });
    expect(stop.status).toBe(200);
    expect((await admin.request('/api/me')).body).toMatchObject({
      isPlatformAdmin: true,
      impersonatedBy: null,
    });
  });
});

describe('admin can list the people in a business', () => {
  it('returns members with roles, and refuses non-admins', async () => {
    const org = await ctx.db.query.organization.findFirst({
      where: eq(schema.organization.name, CLINIC.name),
    });
    const res = await admin.request(`/api/admin/businesses/${org!.id}/members`);
    expect(res.status).toBe(200);
    expect(res.body.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: CLINIC.owner.email, role: 'owner' }),
      ]),
    );
    const anon = await ctx.client().request(`/api/admin/businesses/${org!.id}/members`);
    expect([401, 403]).toContain(anon.status);
  });
});

describe('viewing as someone is read-only and audited', () => {
  it('allows reads, blocks writes, and records all of it', async () => {
    await ctx.db.delete(schema.auditLog);
    const owner = await ctx.db.query.user.findFirst({
      where: eq(schema.user.email, CLINIC.owner.email),
    });
    const viewer = await ctx.adminClient();
    await viewer.request('/api/auth/admin/impersonate-user', { json: { userId: owner!.id } });

    expect((await viewer.request('/api/campaigns')).status).toBe(200);
    const write = await viewer.request('/api/campaigns', {
      json: { name: 'Nope', slug: 'nope', draft: { questions: [], settings: {} } },
    });
    expect(write.status).toBe(403);
    expect(write.body.error).toBe('read_only_view');

    await viewer.request('/api/auth/admin/stop-impersonating', { json: {} });

    const audit = await viewer.request('/api/admin/audit');
    expect(audit.status).toBe(200);
    const actions = audit.body.entries.map((e: { action: string }) => e.action).sort();
    expect(actions).toEqual(['impersonation_started', 'impersonation_stopped', 'write_blocked']);
    const started = audit.body.entries.find(
      (e: { action: string }) => e.action === 'impersonation_started',
    );
    expect(started).toMatchObject({ actorName: expect.any(String), targetName: CLINIC.owner.name });

    // Only the platform admin can read the log.
    const ownerClient = ctx.client();
    await ownerClient.signIn(CLINIC.owner.email, clinic.ownerPassword);
    expect((await ownerClient.request('/api/admin/audit')).status).toBe(403);
  });
});
