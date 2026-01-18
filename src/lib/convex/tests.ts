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

// Promote existing test user to admin role and verify email
// Note: This mutation requires AUTH_E2E_TEST_SECRET for security
// User must already exist (created via signup) - sets role to admin AND verifies email
export const createTestAdminUser = mutation({
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
			return { success: false, error: 'User not found. Sign up the user first.' };
		}

		// Check if already admin and verified
		if (user.role === 'admin' && user.emailVerified) {
			return { success: true, alreadyAdmin: true, alreadyVerified: true };
		}

		// Set role to admin AND verify email in one operation
		await ctx.runMutation(components.betterAuth.adapter.updateOne, {
			input: {
				model: 'user',
				where: [{ field: 'email', value: email }],
				update: { role: 'admin', emailVerified: true }
			}
		});

		return {
			success: true,
			wasAdmin: user.role === 'admin',
			wasVerified: user.emailVerified === true
		};
	}
});

// Clean up test data created during E2E tests
// Removes notification recipients with test email patterns
// Note: Does NOT delete test user accounts - only test artifacts
export const cleanupTestData = mutation({
	args: { secret: v.string() },
	handler: async (ctx, { secret }) => {
		// Verify test secret to prevent unauthorized access
		const expectedSecret = process.env.AUTH_E2E_TEST_SECRET;
		if (!expectedSecret || secret !== expectedSecret) {
			throw new Error('Unauthorized: Invalid test secret');
		}

		// Patterns for test data emails created during E2E tests
		const testPatterns = ['test-e2e-', 'test-dup-', 'test-remove-'];
		let deletedCount = 0;

		// Find and delete test notification recipients
		const allPreferences = await ctx.db.query('adminNotificationPreferences').collect();

		for (const pref of allPreferences) {
			const matchesPattern = testPatterns.some((pattern) => pref.email.startsWith(pattern));

			if (matchesPattern) {
				await ctx.db.delete(pref._id);
				deletedCount++;
			}
		}

		return {
			success: true,
			deletedCount,
			message: `Cleaned up ${deletedCount} test notification recipients`
		};
	}
});
