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

// Create anonymous support thread(s) for E2E tests
// Note: This mutation requires AUTH_E2E_TEST_SECRET for security
// Use count param to create multiple threads (for pagination testing)
export const createAnonymousSupportThread = mutation({
	args: {
		secret: v.string(),
		anonymousUserId: v.string(),
		title: v.optional(v.string()),
		pageUrl: v.optional(v.string()),
		count: v.optional(v.number())
	},
	handler: async (ctx, { secret, anonymousUserId, title, pageUrl, count = 1 }) => {
		const expectedSecret = process.env.AUTH_E2E_TEST_SECRET;
		if (!expectedSecret || secret !== expectedSecret) {
			throw new Error('Unauthorized: Invalid test secret');
		}

		if (!isAnonymousUser(anonymousUserId)) {
			throw new Error('Invalid anonymous user ID');
		}

		const threadIds: string[] = [];

		for (let i = 0; i < count; i++) {
			const threadTitle =
				count > 1 ? `${title ?? 'E2E Support Thread'} #${i + 1}` : (title ?? 'E2E Support Thread');
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

			threadIds.push(threadId);
		}

		return { threadIds, anonymousUserId };
	}
});

// Get support threads by userId for E2E test verification
// Note: This mutation requires AUTH_E2E_TEST_SECRET for security
export const getSupportThreadsByUserId = mutation({
	args: {
		secret: v.string(),
		userId: v.string()
	},
	handler: async (ctx, { secret, userId }) => {
		const expectedSecret = process.env.AUTH_E2E_TEST_SECRET;
		if (!expectedSecret || secret !== expectedSecret) {
			throw new Error('Unauthorized: Invalid test secret');
		}

		const threads = await ctx.db
			.query('supportThreads')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.collect();

		return threads.map((t) => ({
			threadId: t.threadId,
			userId: t.userId,
			userName: t.userName,
			userEmail: t.userEmail
		}));
	}
});

// Get the authenticated user's ID by email for E2E test verification
// Note: This mutation requires AUTH_E2E_TEST_SECRET for security
export const getAuthUserIdByEmail = mutation({
	args: {
		secret: v.string(),
		email: v.string()
	},
	handler: async (ctx, { secret, email }) => {
		const expectedSecret = process.env.AUTH_E2E_TEST_SECRET;
		if (!expectedSecret || secret !== expectedSecret) {
			throw new Error('Unauthorized: Invalid test secret');
		}

		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: email }]
		});

		if (!user) {
			return { userId: null };
		}

		return { userId: user._id };
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

// Seed demo data for Nova-like admin framework resources.
// Note: This mutation requires AUTH_E2E_TEST_SECRET for security.
export const seedAdminFrameworkDemoData = mutation({
	args: { secret: v.string(), reset: v.optional(v.boolean()) },
	handler: async (ctx, { secret, reset }) => {
		const expectedSecret = process.env.AUTH_E2E_TEST_SECRET;
		if (!expectedSecret || secret !== expectedSecret) {
			throw new Error('Unauthorized: Invalid test secret');
		}

		if (reset) {
			const [comments, tasks, pivots, tags, projects] = await Promise.all([
				ctx.db.query('adminDemoComments').collect(),
				ctx.db.query('adminDemoTasks').collect(),
				ctx.db.query('adminDemoProjectTags').collect(),
				ctx.db.query('adminDemoTags').collect(),
				ctx.db.query('adminDemoProjects').collect()
			]);
			for (const row of comments) await ctx.db.delete(row._id);
			for (const row of tasks) await ctx.db.delete(row._id);
			for (const row of pivots) await ctx.db.delete(row._id);
			for (const row of tags) await ctx.db.delete(row._id);
			for (const row of projects) await ctx.db.delete(row._id);
		}

		const existingProjects = await ctx.db.query('adminDemoProjects').take(1);
		if (existingProjects.length > 0) {
			return { seeded: false };
		}

		const now = Date.now();
		const urgentTagId = await ctx.db.insert('adminDemoTags', {
			name: 'Urgent',
			color: '#ef4444',
			createdAt: now,
			updatedAt: now
		});
		const growthTagId = await ctx.db.insert('adminDemoTags', {
			name: 'Growth',
			color: '#22c55e',
			createdAt: now,
			updatedAt: now
		});
		const platformTagId = await ctx.db.insert('adminDemoTags', {
			name: 'Platform',
			color: '#3b82f6',
			createdAt: now,
			updatedAt: now
		});

		const projectIds: string[] = [];
		for (const [index, status] of (['draft', 'active', 'active', 'archived'] as const).entries()) {
			const projectId = await ctx.db.insert('adminDemoProjects', {
				name: `Demo Project ${index + 1}`,
				slug: `demo-project-${index + 1}`,
				status,
				ownerEmail: `owner${index + 1}@example.com`,
				budget: 4_000 + index * 1_500,
				isFeatured: index % 2 === 0,
				description: `Seeded demo project ${index + 1}`,
				createdAt: now - index * 60_000,
				updatedAt: now - index * 60_000
			});
			projectIds.push(projectId);
		}

		for (const projectId of projectIds) {
			await ctx.db.insert('adminDemoProjectTags', {
				projectId: projectId as any,
				tagId: urgentTagId,
				createdAt: now
			});
			await ctx.db.insert('adminDemoProjectTags', {
				projectId: projectId as any,
				tagId: growthTagId,
				createdAt: now
			});
		}

		const taskIds: string[] = [];
		for (const [index, status] of (
			['todo', 'in_progress', 'done', 'todo', 'in_progress'] as const
		).entries()) {
			const taskId = await ctx.db.insert('adminDemoTasks', {
				projectId: projectIds[index % projectIds.length] as any,
				title: `Demo Task ${index + 1}`,
				status,
				priority: (['low', 'medium', 'high'] as const)[index % 3],
				estimateHours: 2 + index,
				assigneeEmail: `assignee${index + 1}@example.com`,
				createdAt: now - index * 30_000,
				updatedAt: now - index * 30_000
			});
			taskIds.push(taskId);
		}

		for (const [index, projectId] of projectIds.entries()) {
			await ctx.db.insert('adminDemoComments', {
				text: `Project comment ${index + 1}`,
				authorEmail: `author${index + 1}@example.com`,
				target: { kind: 'project', id: projectId as any },
				targetProjectId: projectId as any,
				targetTaskId: undefined,
				createdAt: now - index * 20_000,
				updatedAt: now - index * 20_000
			});
		}

		for (const [index, taskId] of taskIds.entries()) {
			await ctx.db.insert('adminDemoComments', {
				text: `Task comment ${index + 1}`,
				authorEmail: `task-author${index + 1}@example.com`,
				target: { kind: 'task', id: taskId as any },
				targetProjectId: undefined,
				targetTaskId: taskId as any,
				createdAt: now - index * 10_000,
				updatedAt: now - index * 10_000
			});
		}

		void platformTagId;

		return {
			seeded: true,
			projectCount: projectIds.length,
			taskCount: taskIds.length
		};
	}
});
