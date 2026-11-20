/** T0 spike fixtures for the local-backend runner. */
import { v } from 'convex/values';
import { components } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { resend } from '../emails/resend';

/** Seeds `count` community messages for the read stress. */
export const seedMessages = internalMutation({
	args: { count: v.number(), userId: v.string() },
	returns: v.null(),
	handler: async (ctx, { count, userId }) => {
		for (let i = 0; i < count; i++) {
			await ctx.db.insert('messages', { userId, body: `spike message ${i}` });
		}
		return null;
	}
});

/** Creates a Better Auth user with a live session, for the local-backend runner. */
export const seedSpikeUser = internalMutation({
	args: { name: v.string(), email: v.string(), role: v.optional(v.string()) },
	returns: v.object({ userId: v.string(), sessionId: v.string() }),
	handler: async (ctx, { name, email, role }) => {
		const now = Date.now();
		const user = (await ctx.runMutation(components.betterAuth.adapter.create, {
			input: {
				model: 'user',
				data: { name, email, role, emailVerified: true, createdAt: now, updatedAt: now }
			}
		})) as { _id: string };
		const session = (await ctx.runMutation(components.betterAuth.adapter.create, {
			input: {
				model: 'session',
				data: {
					userId: user._id,
					token: `spike-${now}-${email}`,
					expiresAt: now + 24 * 60 * 60 * 1000,
					createdAt: now,
					updatedAt: now
				}
			}
		})) as { _id: string };
		return { userId: user._id, sessionId: session._id };
	}
});

/** Creates `count` sent Resend component emails, ids for the cancel baseline. */
export const seedResendEmails = internalMutation({
	args: { count: v.number() },
	returns: v.array(v.string()),
	handler: async (ctx, { count }) => {
		const ids: string[] = [];
		for (let i = 0; i < count; i++) {
			ids.push(
				await resend.sendEmailManually(
					ctx,
					{ from: 'spike@example.com', to: 'spike@example.com', subject: `spike ${i}` },
					async () => `spike-message-${i}`
				)
			);
		}
		return ids;
	}
});

/** Inserts one AI chat thread row, so `start` takes its scheduling branch. */
export const seedAiChatThread = internalMutation({
	args: { userId: v.string() },
	returns: v.null(),
	handler: async (ctx, { userId }) => {
		await ctx.db.insert('aiChatThreads', { threadId: `spike-${userId}`, userId, createdAt: 1 });
		return null;
	}
});

/** Writes the user's dismissal row, which invalidates every cached read of it. */
export const setDismissal = internalMutation({
	args: { userId: v.string(), deferredUntil: v.number() },
	returns: v.null(),
	handler: async (ctx, { userId, deferredUntil }) => {
		const row = await ctx.db
			.query('passkeyNudgeDismissals')
			.withIndex('by_userId', (q) => q.eq('userId', userId))
			.unique();
		if (row) await ctx.db.patch('passkeyNudgeDismissals', row._id, { deferredUntil });
		else await ctx.db.insert('passkeyNudgeDismissals', { userId, deferredUntil });
		return null;
	}
});
