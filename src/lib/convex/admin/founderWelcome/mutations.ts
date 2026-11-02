import { v } from 'convex/values';
import type { MutationCtx } from '../../_generated/server';
import { adminMutation } from '../../functions';
import {
	FOUNDER_TEMPLATE_SETTING_KEYS,
	LEGACY_CONTACT_SETTING_KEY,
	founderEmailValidator,
	readFounderEmailSender,
	type FounderEmail
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

/**
 * Write one email's sender row; an undefined `senderUserId` turns the email off.
 * `enabledAt` is stamped when the email goes from off (or no row) to on, kept while
 * it stays on, whoever saves it, and cleared when it is turned off. A welcome row
 * replaces the legacy contact person, so that setting goes.
 */
async function upsertSender(
	ctx: MutationCtx,
	email: FounderEmail,
	adminUserId: string,
	sender: { senderUserId: string | undefined; name: string; title: string; replyTo?: string }
) {
	const existing = await ctx.db
		.query('founderEmailSenders')
		.withIndex('by_email', (q) => q.eq('email', email))
		.unique();
	const now = Date.now();
	const enabledAt =
		sender.senderUserId === undefined
			? undefined
			: existing?.senderUserId !== undefined
				? existing.enabledAt
				: now;
	const fields = { ...sender, enabledAt, updatedAt: now, updatedBy: adminUserId };

	if (existing) {
		await ctx.db.patch('founderEmailSenders', existing._id, fields);
	} else {
		await ctx.db.insert('founderEmailSenders', { email, ...fields });
	}

	if (email === 'welcome') {
		const legacyContact = await ctx.db
			.query('adminSettings')
			.withIndex('by_key', (q) => q.eq('key', LEGACY_CONTACT_SETTING_KEY))
			.unique();
		if (legacyContact) await ctx.db.delete('adminSettings', legacyContact._id);
	}
}

/** Keep the admin's last name, title and reply-to as the defaults of their next email. */
async function upsertProfile(
	ctx: MutationCtx,
	adminUserId: string,
	profile: { name: string; title: string; replyTo?: string }
) {
	const fields = {
		founderWelcomeName: profile.name,
		founderWelcomeTitle: profile.title,
		founderWelcomeReplyTo: profile.replyTo
	};
	const existing = await ctx.db
		.query('adminProfiles')
		.withIndex('by_user', (q) => q.eq('userId', adminUserId))
		.unique();
	if (existing) {
		await ctx.db.patch('adminProfiles', existing._id, fields);
	} else {
		await ctx.db.insert('adminProfiles', { userId: adminUserId, ...fields });
	}
}

type EmailConfigInput = {
	name: string;
	title: string;
	replyTo?: string;
	subject: string;
	body: string;
};

/** Validate and save one email's sender and template, with the caller as its sender. */
async function saveEmailConfig(
	ctx: MutationCtx & { user: { _id: string } },
	email: FounderEmail,
	args: EmailConfigInput
) {
	const adminUserId = ctx.user._id;
	// Strip chars unsafe for email From header (newlines, angle brackets)
	const name = args.name.trim().replace(/[\r\n<>]/g, '');
	const title = args.title.trim();
	const replyTo = args.replyTo?.trim() || undefined;
	const subject = args.subject.trim();
	const body = args.body.trim();

	if (!name) throw createFounderWelcomeError(FOUNDER_WELCOME_ERROR_CODES.nameRequired);
	if (!title) throw createFounderWelcomeError(FOUNDER_WELCOME_ERROR_CODES.titleRequired);
	if (!subject) throw createFounderWelcomeError(FOUNDER_WELCOME_ERROR_CODES.subjectRequired);
	if (!body) throw createFounderWelcomeError(FOUNDER_WELCOME_ERROR_CODES.bodyRequired);
	if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
		throw createFounderWelcomeError(FOUNDER_WELCOME_ERROR_CODES.replyToInvalid);
	}

	// An undefined reply-to clears one saved before, so replies go to the sender's
	// account address again.
	await upsertSender(ctx, email, adminUserId, { senderUserId: adminUserId, name, title, replyTo });
	await upsertProfile(ctx, adminUserId, { name, title, replyTo });

	const keys = FOUNDER_TEMPLATE_SETTING_KEYS[email];
	await upsertSetting(ctx, keys.subject, subject, adminUserId);
	await upsertSetting(ctx, keys.body, body, adminUserId);
}

/** Stop one email. Only its current sender can; the values and template stay. */
async function stopEmail(ctx: MutationCtx & { user: { _id: string } }, email: FounderEmail) {
	const sender = await readFounderEmailSender(ctx.db, email);
	if (sender.senderUserId !== ctx.user._id) {
		throw createFounderWelcomeError(FOUNDER_WELCOME_ERROR_CODES.notCurrentSender);
	}
	await upsertSender(ctx, email, ctx.user._id, {
		senderUserId: undefined,
		name: sender.name ?? '',
		title: sender.title ?? '',
		replyTo: sender.replyTo
	});
}

/**
 * Save one founder email and become its sender. Any admin can call this; the email
 * then goes out with this name and reply-to, while the others keep their own
 * sender. Name, title and reply-to also become this admin's defaults.
 */
export const updateEmailConfig = adminMutation({
	args: {
		email: founderEmailValidator,
		name: v.string(),
		title: v.string(),
		replyTo: v.optional(v.string()),
		subject: v.string(),
		body: v.string()
	},
	returns: v.null(),
	handler: async (ctx, { email, ...args }) => {
		await saveEmailConfig(ctx, email, args);
		return null;
	}
});

/**
 * Stop sending one founder email. Only its current sender can do this. The sender
 * values and the template stay for the next admin who turns it on.
 */
export const disableEmail = adminMutation({
	args: { email: founderEmailValidator },
	returns: v.null(),
	handler: async (ctx, { email }) => {
		await stopEmail(ctx, email);
		return null;
	}
});

/**
 * Save the welcome and become its sender, as the welcome card did before each
 * founder email got its own card. Kept published for browser tabs still running
 * that bundle.
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
		await saveEmailConfig(ctx, 'welcome', args);
		return null;
	}
});

/** Stop the welcome, under its former name; kept published like `updateConfig`. */
export const stepDown = adminMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		await stopEmail(ctx, 'welcome');
		return null;
	}
});
