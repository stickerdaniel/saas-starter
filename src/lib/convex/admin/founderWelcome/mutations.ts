import { v } from 'convex/values';
import { adminMutation } from '../../functions';
import { FOUNDER_WELCOME_DEFAULTS } from '../../emails/helpers';

/** Helper to upsert an admin setting */
async function upsertSetting(ctx: any, key: string, value: string, adminUserId: string) {
	const existing = await ctx.db
		.query('adminSettings')
		.withIndex('by_key', (q: any) => q.eq('key', key))
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
async function deleteSetting(ctx: any, key: string) {
	const existing = await ctx.db
		.query('adminSettings')
		.withIndex('by_key', (q: any) => q.eq('key', key))
		.first();

	if (existing) {
		await ctx.db.delete(existing._id);
	}
}

/**
 * Become the contact person for founder welcome emails.
 * If title provided (first-time setup), sets it + populates defaults.
 * If title omitted (takeover), preserves existing config.
 */
export const becomeContactPerson = adminMutation({
	args: {
		title: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const adminUserId = ctx.user._id;

		// Set this admin as contact person
		await upsertSetting(ctx, 'founderWelcome.contactUserId', adminUserId, adminUserId);

		// If title provided (first-time setup or explicit update), set title + defaults
		if (args.title !== undefined) {
			if (!args.title.trim()) {
				throw new Error('Title cannot be empty');
			}
			await upsertSetting(ctx, 'founderWelcome.title', args.title, adminUserId);
			await upsertSetting(
				ctx,
				'founderWelcome.subject',
				FOUNDER_WELCOME_DEFAULTS.subject,
				adminUserId
			);
			await upsertSetting(ctx, 'founderWelcome.body', FOUNDER_WELCOME_DEFAULTS.body, adminUserId);
		}
		// If title omitted (takeover), preserve existing title/subject/body

		return null;
	}
});

/**
 * Update founder welcome config.
 * Only works if caller is the current contact person.
 */
export const updateConfig = adminMutation({
	args: {
		title: v.optional(v.string()),
		subject: v.optional(v.string()),
		body: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		// Verify caller is the current contact person
		const contactSetting = await ctx.db
			.query('adminSettings')
			.withIndex('by_key', (q) => q.eq('key', 'founderWelcome.contactUserId'))
			.unique();

		if (!contactSetting || contactSetting.value !== ctx.user._id) {
			throw new Error('Only the current contact person can update the config');
		}

		const adminUserId = ctx.user._id;

		if (args.title !== undefined) {
			if (!args.title.trim()) {
				throw new Error('Title cannot be empty');
			}
			await upsertSetting(ctx, 'founderWelcome.title', args.title, adminUserId);
		}
		if (args.subject !== undefined) {
			if (!args.subject.trim()) {
				throw new Error('Subject cannot be empty');
			}
			await upsertSetting(ctx, 'founderWelcome.subject', args.subject, adminUserId);
		}
		if (args.body !== undefined) {
			if (!args.body.trim()) {
				throw new Error('Body cannot be empty');
			}
			await upsertSetting(ctx, 'founderWelcome.body', args.body, adminUserId);
		}

		return null;
	}
});

/**
 * Step down as contact person. Clears all founder welcome settings.
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
			throw new Error('Only the current contact person can step down');
		}

		// Delete all founder welcome settings
		// Sequential deletes acceptable here (at most 4 settings)
		await deleteSetting(ctx, 'founderWelcome.contactUserId');
		await deleteSetting(ctx, 'founderWelcome.title');
		await deleteSetting(ctx, 'founderWelcome.subject');
		await deleteSetting(ctx, 'founderWelcome.body');

		return null;
	}
});
