import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/organization/access';

/**
 * Business-level permissions. Role names are generic on purpose (a clinic's "receptionist"
 * and a club's "front desk" are both a `manager`); businesses rename the labels in settings.
 *
 * Better Auth's own organization/member/invitation statements are kept so team management
 * keeps working; the rest are LeadGen resources.
 */
export const statement = {
  ...defaultStatements,
  settings: ['read', 'update'],
  whatsappNumber: ['read'],
  campaign: ['read', 'create', 'update', 'publish', 'delete'],
  resource: ['read', 'create', 'update', 'delete'],
  lead: ['read', 'update'],
  booking: ['read', 'update'],
  inbox: ['read', 'reply'],
  analytics: ['read'],
} as const;

export const ac = createAccessControl(statement);

/** Full control of the business. */
export const owner = ac.newRole({
  // No organization:delete — businesses are created and removed by the platform admin only.
  organization: ['update'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  settings: ['read', 'update'],
  whatsappNumber: ['read'],
  campaign: ['read', 'create', 'update', 'publish', 'delete'],
  resource: ['read', 'create', 'update', 'delete'],
  lead: ['read', 'update'],
  booking: ['read', 'update'],
  inbox: ['read', 'reply'],
  analytics: ['read'],
});

/** Runs day-to-day operations (all leads, bookings, inbox) but can't change setup. */
export const manager = ac.newRole({
  settings: ['read'],
  campaign: ['read'],
  resource: ['read'],
  lead: ['read', 'update'],
  booking: ['read', 'update'],
  inbox: ['read', 'reply'],
  analytics: ['read'],
});

/** Sees and updates only the bookings on their own linked resources (scoped in queries). */
export const member = ac.newRole({
  booking: ['read', 'update'],
});

export const roles = { owner, manager, member };

export const BUSINESS_ROLES = ['owner', 'manager', 'member'] as const;
export type BusinessRole = (typeof BUSINESS_ROLES)[number];

/** The platform-level role (Better Auth admin plugin) that can see every business and impersonate. */
export const PLATFORM_ADMIN_ROLE = 'admin';

export type Permissions = {
  [K in keyof typeof statement]?: Array<(typeof statement)[K][number]>;
};

/** Pure permission check for a business role; mirrors what the API enforces. */
export function roleCan(role: BusinessRole, permissions: Permissions): boolean {
  const result = roles[role].authorize(permissions as never);
  return result.success;
}
