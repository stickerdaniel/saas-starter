import { v } from 'convex/values';
import type { MutationCtx } from '../../_generated/server';
import { adminMutation } from '../../functions';
import {
	CONTACT_SETTING_KEY,
	FOUNDER_EMAIL_SETTING_KEYS,
	readFounderEmailEnabledAt,
	switchableFounderEmailValidator
} from '../../emails/founderEmailConfig';
import { FOUNDER_WELCOME_ERROR_CODES, createFounderWelcomeError } from './errors';

/** Helper to upsert an admin setting */
async function upsertSetting(ctx: MutationCtx, key: string, value: string, adminUserId: string) {
	const existing = await ctx.db
		.query('adminSettings')
		.withIndex('by_key', (q) => q.eq('key', key))
		.unique();

	if (existing) {
		await ctx.db.patch('adminSettings', existing._id, {
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
		.unique();

	if (existing) {
		await ctx.db.delete('adminSettings', existing._id);
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

		if (!name) throw createFounderWelcomeError(FOUNDER_WELCOME_ERROR_CODES.nameRequired);
		if (!title) throw createFounderWelcomeError(FOUNDER_WELCOME_ERROR_CODES.titleRequired);
		if (!subject) throw createFounderWelcomeError(FOUNDER_WELCOME_ERROR_CODES.subjectRequired);
		if (!body) throw createFounderWelcomeError(FOUNDER_WELCOME_ERROR_CODES.bodyRequired);
		if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
			throw createFounderWelcomeError(FOUNDER_WELCOME_ERROR_CODES.replyToInvalid);
		}

		// Set this admin as contact person
		await upsertSetting(ctx, 'founderWelcome.contactUserId', adminUserId, adminUserId);

		// Upsert per-user profile (name, title, replyTo)
		const existingProfile = await ctx.db
			.query('adminProfiles')
			.withIndex('by_user', (q) => q.eq('userId', adminUserId))
			.unique();

		if (existingProfile) {
			await ctx.db.patch('adminProfiles', existingProfile._id, {
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
			throw createFounderWelcomeError(FOUNDER_WELCOME_ERROR_CODES.notCurrentContact);
		}

		await deleteSetting(ctx, 'founderWelcome.contactUserId');

		return null;
	}
});

/**
 * The feedback and cancellation emails go out as the welcome's contact person, so
 * only that admin may change them, as only they edit the welcome in place. Another
 * admin becomes the contact through `updateConfig` first.
 */
async function requireContactPerson(ctx: MutationCtx, adminUserId: string) {
	const contactSetting = await ctx.db
		.query('adminSettings')
		.withIndex('by_key', (q) => q.eq('key', CONTACT_SETTING_KEY))
		.unique();
	if (contactSetting?.value !== adminUserId) {
		throw createFounderWelcomeError(FOUNDER_WELCOME_ERROR_CODES.notCurrentContact);
	}
}

/**
 * Switch the feedback or cancellation email on or off. Switching on stores when,
 * and a repeated switch-on keeps the first time; switching off clears it. Only the
 * contact person can call this.
 */
export const setFounderEmailEnabled = adminMutation({
	args: { email: switchableFounderEmailValidator, enabled: v.boolean() },
	returns: v.null(),
	handler: async (ctx, { email, enabled }) => {
		await requireContactPerson(ctx, ctx.user._id);
		const key = FOUNDER_EMAIL_SETTING_KEYS[email].enabledAt;
		if (!enabled) {
			await deleteSetting(ctx, key);
		} else if ((await readFounderEmailEnabledAt(ctx.db, email)) === undefined) {
			await upsertSetting(ctx, key, String(Date.now()), ctx.user._id);
		}
		return null;
	}
});

/** Save the feedback or cancellation template. Only the contact person can call this. */
export const updateFounderEmailTemplate = adminMutation({
	args: { email: switchableFounderEmailValidator, subject: v.string(), body: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireContactPerson(ctx, ctx.user._id);
		const subject = args.subject.trim();
		const body = args.body.trim();
		if (!subject) throw createFounderWelcomeError(FOUNDER_WELCOME_ERROR_CODES.subjectRequired);
		if (!body) throw createFounderWelcomeError(FOUNDER_WELCOME_ERROR_CODES.bodyRequired);

		const keys = FOUNDER_EMAIL_SETTING_KEYS[args.email];
		await upsertSetting(ctx, keys.subject, subject, ctx.user._id);
		await upsertSetting(ctx, keys.body, body, ctx.user._id);
		return null;
	}
});
