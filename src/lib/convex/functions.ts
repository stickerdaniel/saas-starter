/**
 * Custom Convex function builders with built-in authorization
 *
 * These wrappers provide type-safe authentication and authorization
 * following the official Convex pattern from convex-helpers.
 *
 * @see https://stack.convex.dev/custom-functions
 */
import { customQuery, customMutation, customCtx } from 'convex-helpers/server/customFunctions';
import { query, mutation } from './_generated/server';
import { components } from './_generated/api';
import { authComponent } from './auth';
import type { BetterAuthUser, BetterAuthSession } from './admin/types';

/**
 * Query that requires any authenticated user
 *
 * Usage:
 * ```ts
 * export const myQuery = authedQuery({
 *   args: { ... },
 *   handler: async (ctx, args) => {
 *     // ctx.user is typed as BetterAuthUser
 *   }
 * });
 * ```
 */
export const authedQuery = customQuery(
	query,
	customCtx(async (ctx) => {
		const user = (await authComponent.getAuthUser(ctx)) as BetterAuthUser | null;
		if (!user) {
			throw new Error('Authentication required');
		}
		return { user };
	})
);

/**
 * Mutation that requires any authenticated user
 */
export const authedMutation = customMutation(
	mutation,
	customCtx(async (ctx) => {
		const user = (await authComponent.getAuthUser(ctx)) as BetterAuthUser | null;
		if (!user) {
			throw new Error('Authentication required');
		}
		return { user };
	})
);

/**
 * Query that requires admin role
 *
 * Usage:
 * ```ts
 * export const adminOnlyQuery = adminQuery({
 *   args: { ... },
 *   handler: async (ctx, args) => {
 *     // ctx.user is typed as BetterAuthUser with role='admin'
 *   }
 * });
 * ```
 */
export const adminQuery = customQuery(
	query,
	customCtx(async (ctx) => {
		const user = (await authComponent.getAuthUser(ctx)) as BetterAuthUser | null;
		if (!user || user.role !== 'admin') {
			throw new Error('Unauthorized: Admin access required');
		}
		return { user };
	})
);

/**
 * Mutation that requires admin role
 */
export const adminMutation = customMutation(
	mutation,
	customCtx(async (ctx) => {
		const user = (await authComponent.getAuthUser(ctx)) as BetterAuthUser | null;
		if (!user || user.role !== 'admin') {
			throw new Error('Unauthorized: Admin access required');
		}
		return { user };
	})
);

/**
 * Get the active session for the current user.
 * Queries the Better Auth session table using the session ID from the JWT identity.
 */
export async function getActiveSession(
	ctx: Parameters<typeof authComponent.getAuthUser>[0]
): Promise<BetterAuthSession | null> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) return null;

	// The Better Auth Convex plugin includes sessionId in the JWT claims
	const sessionId = (identity as unknown as { sessionId?: string }).sessionId;
	if (!sessionId) return null;

	const session = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'session',
		where: [{ field: '_id', value: sessionId }]
	})) as BetterAuthSession | null;

	if (!session || session.expiresAt <= Date.now()) return null;
	return session;
}

/**
 * Query that requires an active organization.
 * Provides `ctx.user`, `ctx.organizationId`.
 *
 * Usage:
 * ```ts
 * export const myQuery = orgQuery({
 *   args: { ... },
 *   handler: async (ctx, args) => {
 *     // ctx.user: BetterAuthUser
 *     // ctx.organizationId: string
 *   }
 * });
 * ```
 */
export const orgQuery = customQuery(
	query,
	customCtx(async (ctx) => {
		const user = (await authComponent.getAuthUser(ctx)) as BetterAuthUser | null;
		if (!user) {
			throw new Error('Authentication required');
		}
		const session = await getActiveSession(ctx);
		const organizationId = session?.activeOrganizationId;
		if (!organizationId) {
			throw new Error('No active organization');
		}
		return { user, organizationId };
	})
);

/**
 * Mutation that requires an active organization.
 * Provides `ctx.user`, `ctx.organizationId`.
 */
export const orgMutation = customMutation(
	mutation,
	customCtx(async (ctx) => {
		const user = (await authComponent.getAuthUser(ctx)) as BetterAuthUser | null;
		if (!user) {
			throw new Error('Authentication required');
		}
		const session = await getActiveSession(ctx);
		const organizationId = session?.activeOrganizationId;
		if (!organizationId) {
			throw new Error('No active organization');
		}
		return { user, organizationId };
	})
);
