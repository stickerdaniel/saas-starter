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
// Note: This mutation requires AUTH_E2E_TEST_SECRET for security
// Only use for test accounts - it bypasses the normal email verification flow
export const verifyTestUserEmail = mutation({
	args: { email: v.string(), secret: v.string() },
	handler: async (ctx, { email, secret }) => {
		// Verify test secret to prevent unauthorized access
		const expectedSecret = process.env.AUTH_E2E_TEST_SECRET;
		if (!expectedSecret || secret !== expectedSecret) {
			throw new Error('Unauthorized: Invalid test secret');
		}
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

// Promote test user to admin role
// Note: This mutation requires AUTH_E2E_TEST_SECRET for security
// Only use for test accounts - it bypasses the normal admin promotion flow
export const promoteTestUserToAdmin = mutation({
	args: { email: v.string(), secret: v.string() },
	handler: async (ctx, { email, secret }) => {
		// Verify test secret to prevent unauthorized access
		const expectedSecret = process.env.AUTH_E2E_TEST_SECRET;
		if (!expectedSecret || secret !== expectedSecret) {
			throw new Error('Unauthorized: Invalid test secret');
		}

		// Find user by email using Better Auth adapter
		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: email }]
		});

		if (!user) {
			return { success: false, error: 'User not found' };
		}

		// Check if already admin
		if (user.role === 'admin') {
			return { success: true, alreadyAdmin: true };
		}

		// Promote to admin using Better Auth adapter's updateOne method
		await ctx.runMutation(components.betterAuth.adapter.updateOne, {
			input: {
				model: 'user',
				where: [{ field: 'email', value: email }],
				update: { role: 'admin' }
			}
		});

		return { success: true };
	}
});
