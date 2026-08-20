import { components } from './_generated/api';
import type { ActionCtx, QueryCtx } from './_generated/server';

/**
 * Any context that can run a query. The auth hook hands over a context that can
 * be either, so neither concrete ctx type covers both callers on its own.
 */
type RunQueryCtx = Pick<QueryCtx, 'runQuery'> | Pick<ActionCtx, 'runQuery'>;

/**
 * Credential accounts belonging to a user, as Better Auth itself counts them.
 *
 * Lives apart from its callers because both `users.ts` and `auth.ts` need it and
 * `users.ts` already imports `auth.ts`.
 */
export async function credentialAccounts(
	ctx: RunQueryCtx,
	userId: string
): Promise<Array<{ password?: string | null }>> {
	const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
		model: 'account',
		where: [
			{ field: 'userId', operator: 'eq', value: userId },
			{ field: 'providerId', operator: 'eq', value: 'credential' }
		],
		paginationOpts: { cursor: null, numItems: 200 }
	});
	return result.page as Array<{ password?: string | null }>;
}

/** Whether a user can sign in with a password today. */
export async function hasUsablePassword(ctx: RunQueryCtx, userId: string): Promise<boolean> {
	return (await credentialAccounts(ctx, userId)).some((account) => account.password);
}
