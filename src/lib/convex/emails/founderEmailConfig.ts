import { v, type Infer } from 'convex/values';
import { components } from '../_generated/api';
import type { QueryCtx } from '../_generated/server';
import {
	FOUNDER_CANCELLATION_DEFAULTS,
	FOUNDER_FEEDBACK_DEFAULTS,
	FOUNDER_WELCOME_DEFAULTS,
	shouldSkipTestEmail
} from './helpers';

/**
 * Config reads for the personal founder emails. `welcome` goes to every signup right
 * after signup or verification; `feedback` goes to signups who have never paid 48
 * hours later; `cancellation` asks a customer who scheduled a cancellation what was
 * missing an hour later. All three go out as one sender, the welcome's contact
 * person. Setting a contact switches the welcome on; feedback and cancellation each
 * have their own switch on top.
 *
 * This module registers no functions and must not import `functions.ts`: the
 * signup trigger in `auth.ts` reads it, and `functions.ts` imports `auth.ts`.
 */

/** The founder emails beside the welcome, which an admin switches on and off. */
export const switchableFounderEmailValidator = v.union(
	v.literal('feedback'),
	v.literal('cancellation')
);
export type SwitchableFounderEmail = Infer<typeof switchableFounderEmailValidator>;

export type FounderEmailTemplate = { subject: string; body: string };

/** The admin every founder email goes out as. Unset keeps all three off. */
export const CONTACT_SETTING_KEY = 'founderWelcome.contactUserId';

const WELCOME_TEMPLATE_SETTING_KEYS = {
	subject: 'founderWelcome.subject',
	body: 'founderWelcome.body'
} as const;

/**
 * adminSettings keys of the switchable emails. `enabledAt` holds, as a decimal
 * string, when the email was last switched on; no row means off. The cancellation
 * email asks only about cancellations made after it, so switching it on asks
 * nobody retroactively.
 */
export const FOUNDER_EMAIL_SETTING_KEYS = {
	feedback: {
		enabledAt: 'founderFeedback.enabledAt',
		subject: 'founderFeedback.subject',
		body: 'founderFeedback.body'
	},
	cancellation: {
		enabledAt: 'founderCancellation.enabledAt',
		subject: 'founderCancellation.subject',
		body: 'founderCancellation.body'
	}
} as const satisfies Record<SwitchableFounderEmail, Record<string, string>>;

export const FOUNDER_TEMPLATE_DEFAULTS: Record<SwitchableFounderEmail, FounderEmailTemplate> = {
	feedback: FOUNDER_FEEDBACK_DEFAULTS,
	cancellation: FOUNDER_CANCELLATION_DEFAULTS
};

export async function readAdminSetting(db: QueryCtx['db'], key: string) {
	return await db
		.query('adminSettings')
		.withIndex('by_key', (q) => q.eq('key', key))
		.unique();
}

export async function readAuthUser(ctx: QueryCtx, userId: string) {
	const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: '_id', operator: 'eq', value: userId }]
	});
	return user as {
		name?: string;
		email: string;
		emailVerified?: boolean;
		role?: string | null;
	} | null;
}

/** The sender of every founder email, as the welcome has always resolved it. */
export type FounderSender = {
	contactUser: { id: string; name: string; email: string };
	name: string;
	title: string;
	replyTo: string;
};

/**
 * The welcome's contact person and their `adminProfiles` values. Null without a
 * contact, or when the contact's account no longer exists.
 */
export async function readFounderSender(ctx: QueryCtx): Promise<FounderSender | null> {
	const contactSetting = await readAdminSetting(ctx.db, CONTACT_SETTING_KEY);
	if (!contactSetting) return null;
	const contactUserId = contactSetting.value;
	const user = await readAuthUser(ctx, contactUserId);
	if (!user) return null;

	const profile = await ctx.db
		.query('adminProfiles')
		.withIndex('by_user', (q) => q.eq('userId', contactUserId))
		.unique();
	return {
		contactUser: { id: contactUserId, name: user.name || 'Unknown', email: user.email },
		name: profile?.founderWelcomeName ?? user.name ?? 'Unknown',
		title: profile?.founderWelcomeTitle ?? '',
		replyTo: profile?.founderWelcomeReplyTo ?? user.email
	};
}

export async function readWelcomeTemplate(db: QueryCtx['db']): Promise<FounderEmailTemplate> {
	return {
		subject:
			(await readAdminSetting(db, WELCOME_TEMPLATE_SETTING_KEYS.subject))?.value ??
			FOUNDER_WELCOME_DEFAULTS.subject,
		body:
			(await readAdminSetting(db, WELCOME_TEMPLATE_SETTING_KEYS.body))?.value ??
			FOUNDER_WELCOME_DEFAULTS.body
	};
}

export async function readFounderEmailTemplate(
	db: QueryCtx['db'],
	email: SwitchableFounderEmail
): Promise<FounderEmailTemplate> {
	const keys = FOUNDER_EMAIL_SETTING_KEYS[email];
	return {
		subject:
			(await readAdminSetting(db, keys.subject))?.value ?? FOUNDER_TEMPLATE_DEFAULTS[email].subject,
		body: (await readAdminSetting(db, keys.body))?.value ?? FOUNDER_TEMPLATE_DEFAULTS[email].body
	};
}

/** When a switchable email was last switched on, or undefined while it is off. */
export async function readFounderEmailEnabledAt(
	db: QueryCtx['db'],
	email: SwitchableFounderEmail
): Promise<number | undefined> {
	const setting = await readAdminSetting(db, FOUNDER_EMAIL_SETTING_KEYS[email].enabledAt);
	return setting ? Number(setting.value) : undefined;
}

/**
 * When a switchable email went on, if it is on and a contact is set, read from this
 * database alone. Gates creating ledger rows; the send itself still checks that the
 * contact's account exists.
 */
export async function readFounderEmailActiveSince(
	db: QueryCtx['db'],
	email: SwitchableFounderEmail
): Promise<number | undefined> {
	if (!(await readAdminSetting(db, CONTACT_SETTING_KEY))) return undefined;
	return await readFounderEmailEnabledAt(db, email);
}

/** One switchable email's sender and template, as the send reads it. */
export type FounderEmailConfig =
	{ enabled: true; sender: FounderSender; template: FounderEmailTemplate } | { enabled: false };

/** A switchable email's config: on while its switch is on and the contact exists. */
export async function readFounderEmailConfig(
	ctx: QueryCtx,
	email: SwitchableFounderEmail
): Promise<FounderEmailConfig> {
	if ((await readFounderEmailEnabledAt(ctx.db, email)) === undefined) return { enabled: false };
	const sender = await readFounderSender(ctx);
	if (!sender) return { enabled: false };
	return { enabled: true, sender, template: await readFounderEmailTemplate(ctx.db, email) };
}

/**
 * Why a founder email may not go to a user, in the order the reasons are recorded.
 * `suppressed` is the per-user opt-out in `personalEmailSuppressions`.
 */
export type FounderRecipientSkipReason =
	'user_deleted' | 'not_verified' | 'email_changed' | 'test_email' | 'suppressed';

/**
 * The recipient checks all three founder emails share. `recipientEmail` is the
 * address the ledger row was opened for; `logContext` labels the test-address log.
 */
export async function checkFounderRecipient(
	ctx: QueryCtx,
	args: { userId: string; recipientEmail: string; logContext: string }
): Promise<
	| { ok: false; reason: FounderRecipientSkipReason }
	| { ok: true; user: { email: string; name?: string; role?: string | null } }
> {
	const user = await readAuthUser(ctx, args.userId);
	if (!user) return { ok: false, reason: 'user_deleted' };
	if (!user.emailVerified) return { ok: false, reason: 'not_verified' };
	if (user.email !== args.recipientEmail) return { ok: false, reason: 'email_changed' };
	if (shouldSkipTestEmail(args.logContext, user.email)) return { ok: false, reason: 'test_email' };
	const suppression = await ctx.db
		.query('personalEmailSuppressions')
		.withIndex('by_user', (q) => q.eq('userId', args.userId))
		.first();
	if (suppression) return { ok: false, reason: 'suppressed' };
	return { ok: true, user };
}
