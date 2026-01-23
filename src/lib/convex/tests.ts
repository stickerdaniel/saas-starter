import { components } from './_generated/api';
import { mutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';
import { supportAgent } from './support/agent';
import { isAnonymousUser } from './utils/anonymousUser';

function buildSearchText(fields: {
	title?: string;
	summary?: string;
	userName?: string;
	userEmail?: string;
}): string {
	return (
		[fields.title, fields.summary, fields.userName, fields.userEmail]
			.filter(Boolean)
			.join(' | ')
			.toLowerCase() || 'untitled'
	);
}

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

		// Create notification preferences entry for the admin (needed for admin-settings E2E tests)
		const existingPref = await ctx.db
			.query('adminNotificationPreferences')
			.withIndex('by_email', (q) => q.eq('email', email))
			.first();

		if (!existingPref) {
			await ctx.db.insert('adminNotificationPreferences', {
				email,
				userId: user._id,
				isAdminUser: true,
				notifyNewSupportTickets: true,
				notifyUserReplies: true,
				notifyNewSignups: true,
				createdAt: Date.now(),
				updatedAt: Date.now()
			});
		}

		return {
			success: true,
			wasAdmin: user.role === 'admin',
			wasVerified: user.emailVerified === true
		};
	}
});

// Create an anonymous support thread for E2E tests
// Note: This mutation requires AUTH_E2E_TEST_SECRET for security
export const createAnonymousSupportThread = mutation({
	args: {
		secret: v.string(),
		anonymousUserId: v.string(),
		title: v.optional(v.string()),
		pageUrl: v.optional(v.string())
	},
	handler: async (ctx, { secret, anonymousUserId, title, pageUrl }) => {
		const expectedSecret = process.env.AUTH_E2E_TEST_SECRET;
		if (!expectedSecret || secret !== expectedSecret) {
			throw new Error('Unauthorized: Invalid test secret');
		}

		if (!isAnonymousUser(anonymousUserId)) {
			throw new Error('Invalid anonymous user ID');
		}

		const threadTitle = title ?? 'E2E Support Thread';
		const summary = 'New support conversation';
		const searchText = buildSearchText({ title: threadTitle, summary });

		const { threadId } = await supportAgent.createThread(ctx, {
			userId: anonymousUserId,
			title: threadTitle,
			summary
		});

		await ctx.db.insert('supportThreads', {
			threadId,
			userId: anonymousUserId,
			status: 'open',
			isHandedOff: false,
			awaitingAdminResponse: true,
			assignedTo: undefined,
			priority: undefined,
			pageUrl: pageUrl || undefined,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			notificationEmail: undefined,
			searchText,
			title: threadTitle,
			summary,
			lastMessage: undefined,
			userName: undefined,
			userEmail: undefined
		});

		return { threadId, anonymousUserId };
	}
});

// Clean up anonymous support threads created in E2E tests
// Note: This mutation requires AUTH_E2E_TEST_SECRET for security
export const cleanupAnonymousSupportThreads = mutation({
	args: {
		secret: v.string(),
		threadIds: v.array(v.string())
	},
	handler: async (ctx, { secret, threadIds }) => {
		const expectedSecret = process.env.AUTH_E2E_TEST_SECRET;
		if (!expectedSecret || secret !== expectedSecret) {
			throw new Error('Unauthorized: Invalid test secret');
		}

		let deletedSupportThreads = 0;
		let deletedAgentThreads = 0;

		for (const threadId of threadIds) {
			try {
				await supportAgent.deleteThreadAsync(ctx, { threadId, pageSize: 100 });
				deletedAgentThreads++;
			} catch (error) {
				console.warn(
					`[cleanupAnonymousSupportThreads] Failed to delete agent thread ${threadId}:`,
					error
				);
			}

			const supportThread = await ctx.db
				.query('supportThreads')
				.withIndex('by_thread', (q) => q.eq('threadId', threadId))
				.first();

			if (supportThread) {
				await ctx.db.delete(supportThread._id);
				deletedSupportThreads++;
			}
		}

		return {
			success: true,
			deletedSupportThreads,
			deletedAgentThreads
		};
	}
});

// Delete a test user and all their associated accounts/sessions
// Used by globalTeardown to clean up fresh test users created each run
export const deleteTestUser = mutation({
	args: { email: v.string(), secret: v.string() },
	handler: async (ctx, { email, secret }) => {
		// Verify test secret to prevent unauthorized access
		const expectedSecret = process.env.AUTH_E2E_TEST_SECRET;
		if (!expectedSecret || secret !== expectedSecret) {
			throw new Error('Unauthorized: Invalid test secret');
		}

		// Find user by email
		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: email }]
		});

		if (!user) {
			return { success: false, error: 'User not found' };
		}

		// Delete ALL associated account records (loop until none remain)
		let accountsDeleted = 0;
		let hasMoreAccounts = true;
		while (hasMoreAccounts) {
			const result = await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
				input: {
					model: 'account',
					where: [{ field: 'userId', value: user._id }]
				},
				paginationOpts: { numItems: 100, cursor: null }
			});
			accountsDeleted += result?.deletedCount ?? 0;
			hasMoreAccounts = (result?.deletedCount ?? 0) >= 100;
		}

		// Delete ALL associated sessions (loop until none remain)
		let sessionsDeleted = 0;
		let hasMoreSessions = true;
		while (hasMoreSessions) {
			const result = await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
				input: {
					model: 'session',
					where: [{ field: 'userId', value: user._id }]
				},
				paginationOpts: { numItems: 100, cursor: null }
			});
			sessionsDeleted += result?.deletedCount ?? 0;
			hasMoreSessions = (result?.deletedCount ?? 0) >= 100;
		}

		// Delete the user
		await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
			input: {
				model: 'user',
				where: [{ field: 'email', value: email }]
			}
		});

		return { success: true, deletedEmail: email, accountsDeleted, sessionsDeleted };
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
