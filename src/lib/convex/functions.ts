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
import { authComponent } from './auth';
import type { BetterAuthUser } from './admin/types';

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
