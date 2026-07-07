import { v } from 'convex/values';
import * as val from 'valibot';

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
 * Valibot schema for Better Auth user records.
 * Provides runtime validation when fetching from the Better Auth adapter.
 */
export const betterAuthUserSchema = val.object({
	_id: val.string(),
	name: val.optional(val.string()),
	email: val.string(),
	emailVerified: val.optional(val.boolean()),
	image: val.optional(val.nullable(val.string())),
	role: val.optional(val.nullable(val.picklist(['user', 'admin']))),
	banned: val.optional(val.nullable(val.boolean())),
	banReason: val.optional(val.nullable(val.string())),
	banExpires: val.optional(val.nullable(val.number())),
	createdAt: val.optional(val.number()),
	updatedAt: val.optional(val.number())
});

/**
 * Valibot schema for Better Auth session records.
 */
export const betterAuthSessionSchema = val.object({
	_id: val.string(),
	userId: val.string(),
	expiresAt: val.number(),
	createdAt: val.optional(val.number()),
	updatedAt: val.optional(val.number()),
	impersonatedBy: val.optional(val.string())
});

/**
 * Safely parse an array of Better Auth user records.
 * Filters out invalid records and logs warnings.
 */
export function parseBetterAuthUsers(data: unknown[]): BetterAuthUser[] {
	const users: BetterAuthUser[] = [];
	for (const item of data) {
		const result = val.safeParse(betterAuthUserSchema, item);
		if (result.success) {
			users.push(result.output);
		} else {
			console.warn('[parseBetterAuthUsers] Invalid user record:', result.issues[0]?.message);
		}
	}
	return users;
}

/**
 * Safely parse an array of Better Auth session records.
 * Filters out invalid records and logs warnings.
 */
export function parseBetterAuthSessions(data: unknown[]): BetterAuthSession[] {
	const sessions: BetterAuthSession[] = [];
	for (const item of data) {
		const result = val.safeParse(betterAuthSessionSchema, item);
		if (result.success) {
			sessions.push(result.output);
		} else {
			console.warn('[parseBetterAuthSessions] Invalid session record:', result.issues[0]?.message);
		}
	}
	return sessions;
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
	providers: string[];
	createdAt?: number;
	updatedAt?: number;
}

/**
 * Convex return validator mirroring {@link AdminUserData}.
 * Keep both in sync when adding fields.
 */
export const adminUserDataValidator = v.object({
	id: v.string(),
	name: v.optional(v.string()),
	email: v.string(),
	emailVerified: v.optional(v.boolean()),
	image: v.optional(v.union(v.string(), v.null())),
	role: roleValidator,
	banned: v.boolean(),
	banReason: v.optional(v.union(v.string(), v.null())),
	banExpires: v.optional(v.union(v.number(), v.null())),
	providers: v.array(v.string()),
	createdAt: v.optional(v.number()),
	updatedAt: v.optional(v.number())
});
