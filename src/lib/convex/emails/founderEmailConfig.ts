import { v, type Infer } from 'convex/values';
import { components } from '../_generated/api';
import type { QueryCtx } from '../_generated/server';
import {
	FOUNDER_CANCELLATION_DEFAULTS,
	FOUNDER_FEEDBACK_DEFAULTS,
	FOUNDER_WELCOME_DEFAULTS
} from './helpers';

/**
 * Config reads for the personal founder emails. `welcome` goes to every signup right
 * after signup or verification; `feedback` goes to signups who have never paid 48
 * hours later; `cancellation` asks a customer who scheduled a cancellation what was
 * missing an hour later. Each has its own sender and template and is switched on
 * and off on its own.
 *
 * This module registers no functions and must not import `functions.ts`: the
 * signup trigger in `auth.ts` reads it, and `functions.ts` imports `auth.ts`.
 */
export const founderEmailValidator = v.union(
	v.literal('welcome'),
	v.literal('feedback'),
	v.literal('cancellation')
);
export type FounderEmail = Infer<typeof founderEmailValidator>;
export const FOUNDER_EMAILS: FounderEmail[] = founderEmailValidator.members.map(
	(member) => member.value
);

export type FounderEmailTemplate = { subject: string; body: string };

/** One founder email's sender and template, as the send reads it. */
export type FounderEmailConfig =
	| {
			enabled: true;
			senderUserId: string;
			name: string;
			title: string;
			replyTo: string;
			template: FounderEmailTemplate;
	  }
	| { enabled: false };

/** adminSettings keys for the templates; the welcome keeps the keys it always had. */
export const FOUNDER_TEMPLATE_SETTING_KEYS = {
	welcome: { subject: 'founderWelcome.subject', body: 'founderWelcome.body' },
	feedback: { subject: 'founderFeedback.subject', body: 'founderFeedback.body' },
	cancellation: { subject: 'founderCancellation.subject', body: 'founderCancellation.body' }
} as const satisfies Record<FounderEmail, FounderEmailTemplate>;

export const FOUNDER_TEMPLATE_DEFAULTS: Record<FounderEmail, FounderEmailTemplate> = {
	welcome: FOUNDER_WELCOME_DEFAULTS,
	feedback: FOUNDER_FEEDBACK_DEFAULTS,
	cancellation: FOUNDER_CANCELLATION_DEFAULTS
};

/**
 * The welcome's contact person from before each email had its own sender. It still
 * sends the welcome while the welcome has no `founderEmailSenders` row, so an
 * upgraded deployment keeps welcoming signups without anyone saving again.
 */
export const LEGACY_CONTACT_SETTING_KEY = 'founderWelcome.contactUserId';

export type FounderEmailSender = {
	senderUserId?: string;
	name?: string;
	title?: string;
	replyTo?: string;
	/** The admin who last saved or stopped this email; absent for the legacy contact. */
	savedBy?: string;
	/** When the email last went from off to on; absent for the legacy contact. */
	enabledAt?: number;
};

/**
 * The sender settings of one email. A row in `founderEmailSenders` decides, and one
 * without `senderUserId` keeps the email off. Without a row the feedback and
 * cancellation emails are off, and the welcome falls back to the legacy contact
 * person and their `adminProfiles` values.
 */
export async function readFounderEmailSender(
	db: QueryCtx['db'],
	email: FounderEmail
): Promise<FounderEmailSender> {
	const row = await db
		.query('founderEmailSenders')
		.withIndex('by_email', (q) => q.eq('email', email))
		.unique();
	if (row) {
		return {
			senderUserId: row.senderUserId,
			name: row.name,
			title: row.title,
			replyTo: row.replyTo,
			savedBy: row.updatedBy,
			enabledAt: row.enabledAt
		};
	}
	if (email !== 'welcome') return {};

	const contact = await db
		.query('adminSettings')
		.withIndex('by_key', (q) => q.eq('key', LEGACY_CONTACT_SETTING_KEY))
		.unique();
	if (!contact) return {};
	const profile = await db
		.query('adminProfiles')
		.withIndex('by_user', (q) => q.eq('userId', contact.value))
		.unique();
	return {
		senderUserId: contact.value,
		name: profile?.founderWelcomeName,
		title: profile?.founderWelcomeTitle,
		replyTo: profile?.founderWelcomeReplyTo
	};
}

/**
 * Whether an email has a sender, read from this database alone. Gates creating
 * ledger rows; the send itself still checks that the sender's account exists.
 */
export async function founderEmailHasSender(
	db: QueryCtx['db'],
	email: FounderEmail
): Promise<boolean> {
	return (await readFounderEmailSender(db, email)).senderUserId !== undefined;
}

export async function readFounderEmailTemplate(
	db: QueryCtx['db'],
	email: FounderEmail
): Promise<FounderEmailTemplate> {
	const readSetting = async (key: string) =>
		(
			await db
				.query('adminSettings')
				.withIndex('by_key', (q) => q.eq('key', key))
				.unique()
		)?.value;
	const keys = FOUNDER_TEMPLATE_SETTING_KEYS[email];
	return {
		subject: (await readSetting(keys.subject)) ?? FOUNDER_TEMPLATE_DEFAULTS[email].subject,
		body: (await readSetting(keys.body)) ?? FOUNDER_TEMPLATE_DEFAULTS[email].body
	};
}

export async function readAuthUser(ctx: QueryCtx, userId: string) {
	const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: '_id', operator: 'eq', value: userId }]
	});
	return user as { name?: string; email: string } | null;
}

/** One email's config. A sender whose account no longer exists turns the email off. */
export async function readFounderEmailConfig(
	ctx: QueryCtx,
	email: FounderEmail
): Promise<FounderEmailConfig> {
	const sender = await readFounderEmailSender(ctx.db, email);
	if (!sender.senderUserId) return { enabled: false };
	const user = await readAuthUser(ctx, sender.senderUserId);
	if (!user) return { enabled: false };

	return {
		enabled: true,
		senderUserId: sender.senderUserId,
		name: sender.name ?? user.name ?? 'Unknown',
		title: sender.title ?? '',
		replyTo: sender.replyTo ?? user.email,
		template: await readFounderEmailTemplate(ctx.db, email)
	};
}
