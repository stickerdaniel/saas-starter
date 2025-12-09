import { components } from './_generated/api';
import { mutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';

export const getTestUser = internalQuery({
	args: { email: v.string() },
	handler: async (ctx, { email }) => {
		// Use Better Auth adapter to find user by email
		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: email }]
		});
		return user;
	}
});

// Mark test user email as verified
// Note: This is a public mutation for CLI access during E2E test setup
// Only use for test accounts - it bypasses the normal email verification flow
export const verifyTestUserEmail = mutation({
	args: { email: v.string() },
	handler: async (ctx, { email }) => {
		// Find user by email using Better Auth adapter
		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: email }]
		});

		if (!user) {
			return { success: false, error: 'User not found' };
		}

		// Check if already verified (adapter uses emailVerified boolean, stored as emailVerificationTime)
		if (user.emailVerified) {
			return { success: true, alreadyVerified: true };
		}

		// Mark email as verified using Better Auth adapter's updateOne method
		await ctx.runMutation(components.betterAuth.adapter.updateOne, {
			input: {
				model: 'user',
				where: [{ field: 'email', value: email }],
				update: { emailVerified: true }
			}
		});

		return { success: true };
	}
});
