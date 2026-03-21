import { v, ConvexError } from 'convex/values';
import type { MutationCtx } from '../../_generated/server';
import { adminMutation } from '../../functions';

/** Helper to upsert an admin setting */
async function upsertSetting(ctx: MutationCtx, key: string, value: string, adminUserId: string) {
	const existing = await ctx.db
		.query('adminSettings')
		.withIndex('by_key', (q) => q.eq('key', key))
		.first();

	if (existing) {
		await ctx.db.patch(existing._id, {
			value,
			updatedAt: Date.now(),
			updatedBy: adminUserId
		});
	} else {
		await ctx.db.insert('adminSettings', {
			key,
			value,
			updatedAt: Date.now(),
			updatedBy: adminUserId
		});
	}
}

/** Helper to delete an admin setting */
async function deleteSetting(ctx: MutationCtx, key: string) {
	const existing = await ctx.db
		.query('adminSettings')
		.withIndex('by_key', (q) => q.eq('key', key))
		.first();

	if (existing) {
		await ctx.db.delete(existing._id);
	}
}

/**
 * Save founder welcome config and become/stay contact person.
 * Any admin can call this — atomically sets themselves as contact person.
 * Name/title/replyTo stored per-user in adminProfiles, subject/body stored globally.
 */
export const updateConfig = adminMutation({
	args: {
		name: v.string(),
		title: v.string(),
		subject: v.string(),
		body: v.string(),
		replyTo: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const adminUserId = ctx.user._id;
		// Strip chars unsafe for email From header (newlines, angle brackets)
		const name = args.name.trim().replace(/[\r\n<>]/g, '');
		const title = args.title.trim();
		const subject = args.subject.trim();
		const body = args.body.trim();
		const replyTo = args.replyTo?.trim() || undefined;

		if (!name) throw new ConvexError('Name cannot be empty');
		if (!title) throw new ConvexError('Title cannot be empty');
		if (!subject) throw new ConvexError('Subject cannot be empty');
		if (!body) throw new ConvexError('Body cannot be empty');
		if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
			throw new ConvexError('Invalid reply-to email address');
		}

		// Set this admin as contact person
		await upsertSetting(ctx, 'founderWelcome.contactUserId', adminUserId, adminUserId);

		// Upsert per-user profile (name, title, replyTo)
		const existingProfile = await ctx.db
			.query('adminProfiles')
			.withIndex('by_userId', (q) => q.eq('userId', adminUserId))
			.unique();

		if (existingProfile) {
			await ctx.db.patch(existingProfile._id, {
				founderWelcomeName: name,
				founderWelcomeTitle: title,
				founderWelcomeReplyTo: replyTo
			});
		} else {
			await ctx.db.insert('adminProfiles', {
				userId: adminUserId,
				founderWelcomeName: name,
				founderWelcomeTitle: title,
				founderWelcomeReplyTo: replyTo
			});
		}

		// Save global email config
		await upsertSetting(ctx, 'founderWelcome.subject', subject, adminUserId);
		await upsertSetting(ctx, 'founderWelcome.body', body, adminUserId);

		return null;
	}
});

/**
 * Step down as contact person. Only clears contactUserId.
 * Per-user profile and global email config are preserved.
 */
export const stepDown = adminMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		// Verify caller is the current contact person
		const contactSetting = await ctx.db
			.query('adminSettings')
			.withIndex('by_key', (q) => q.eq('key', 'founderWelcome.contactUserId'))
			.unique();

		if (!contactSetting || contactSetting.value !== ctx.user._id) {
			throw new ConvexError('Only the current contact person can step down');
		}

		await deleteSetting(ctx, 'founderWelcome.contactUserId');

		return null;
	}
});
