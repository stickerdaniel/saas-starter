import { v } from 'convex/values';

/**
 * Role enum - single source of truth for user roles.
 * Add new roles here and they will automatically be available
 * in validators and UI components.
 */
export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Convex validator for user roles.
 * Use this in mutation args for type-safe role validation.
 */
export const roleValidator = v.union(v.literal('user'), v.literal('admin'));

/**
 * Admin action types for audit logging.
 */
export const ADMIN_ACTIONS = [
	'impersonate',
	'stop_impersonation',
	'ban_user',
	'unban_user',
	'revoke_sessions',
	'set_role'
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/**
 * Convex validator for admin actions.
 */
export const adminActionValidator = v.union(
	v.literal('impersonate'),
	v.literal('stop_impersonation'),
	v.literal('ban_user'),
	v.literal('unban_user'),
	v.literal('revoke_sessions'),
	v.literal('set_role')
);

/**
 * Typed metadata for audit logs.
 * Each action type has its own metadata shape.
 */
export type AuditMetadata =
	| { reason: string } // ban_user, unban_user
	| { newRole: UserRole; previousRole: UserRole } // set_role
	| Record<string, never>; // other actions (empty object)

/**
 * Convex validator for audit metadata.
 * Accepts typed metadata shapes or empty object.
 */
export const auditMetadataValidator = v.optional(
	v.union(
		v.object({ reason: v.string() }), // ban_user, unban_user
		v.object({ newRole: v.string(), previousRole: v.string() }), // set_role
		v.object({}) // other actions
	)
);

/**
 * Better Auth user type (managed by the BetterAuth component).
 * Consolidated from multiple duplicate definitions.
 */
export interface BetterAuthUser {
	_id: string;
	name?: string;
	email: string;
	emailVerified?: boolean;
	image?: string | null;
	role?: UserRole | null;
	banned?: boolean | null;
	banReason?: string | null;
	banExpires?: number | null;
	createdAt?: number;
	updatedAt?: number;
}

/**
 * Better Auth session type.
 */
export interface BetterAuthSession {
	_id: string;
	userId: string;
	expiresAt: number;
	createdAt?: number;
	updatedAt?: number;
	impersonatedBy?: string;
}

/**
 * User data returned from admin queries (formatted for UI).
 */
export interface AdminUserData {
	id: string;
	name?: string;
	email: string;
	emailVerified?: boolean;
	image?: string | null;
	role: UserRole;
	banned: boolean;
	banReason?: string | null;
	banExpires?: number | null;
	createdAt?: number;
	updatedAt?: number;
}
