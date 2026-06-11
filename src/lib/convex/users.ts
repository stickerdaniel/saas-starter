import { v } from 'convex/values';
import { query } from './_generated/server';
import { authComponent } from './auth';
import { tables } from './betterAuth/schema';

/**
 * Get the currently authenticated user
 *
 * Returns the authenticated user's profile information from the session.
 * Used to check authentication status and access user data on the client.
 *
 * Throws ConvexError('Unauthenticated') when no user is signed in. Callers
 * that need a soft failure must catch (see the JWT payload fallback in
 * src/routes/+layout.server.ts).
 */
export const viewer = query({
	args: {},
	// Field validators come from the Better Auth local-install schema so the
	// returns validator stays in sync with it. User docs live in the component,
	// so _id is a plain string from the app's perspective, not v.id('user').
	returns: v.object({
		_id: v.string(),
		_creationTime: v.number(),
		...tables.user.validator.fields
	}),
	handler: async (ctx) => {
		return authComponent.getAuthUser(ctx);
	}
});
