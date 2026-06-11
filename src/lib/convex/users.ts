import { query } from './_generated/server';
import { v } from 'convex/values';
import { authComponent } from './auth';

/**
 * Get the currently authenticated user
 *
 * Returns the authenticated user's profile information from the session.
 * Used to check authentication status and access user data on the client.
 *
 * @returns User object if authenticated, null otherwise
 */
export const viewer = query({
	args: {},
	// v.any(): user doc shape is owned by the Better Auth component, not this app
	returns: v.any(),
	handler: async (ctx) => {
		return authComponent.getAuthUser(ctx);
	}
});
