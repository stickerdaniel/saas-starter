import type { Doc, Id } from '../../convex/_generated/dataModel';
import type { MutationCtx } from '../../convex/_generated/server';
import {
	checkFounderRecipient,
	readFounderEmailConfig,
	type FounderEmailTemplate,
	type FounderRecipientSkipReason,
	type FounderSender,
	type SwitchableFounderEmail
} from './founderEmailConfig';
import type { FounderThread } from './founderEmailTypes';
import { renderFounderEmail, renderFounderTemplate } from './founderTemplate';
import { assertResendApiKey, getEmailDeliveryConfiguration, resend } from './resend';

/**
 * The personal founder emails beside the welcome, written like a hand-typed message
 * and sent as text with a minimal HTML part, as the welcome's contact person:
 *
 * - The feedback email asks a signup who has never paid, 48 hours after signup
 *   (OAuth) or verification (email/password), what they hoped for, as a reply in
 *   the welcome's thread when the welcome went out. The signup trigger in `auth.ts`
 *   creates its row.
 * - The cancellation email asks a customer who scheduled a cancellation what was
 *   missing, an hour after the cancellation. Admission of the admin customer emails'
 *   billing observation creates its row; the send asks Autumn first whether that
 *   same cancellation still stands.
 *
 * Both run in two passes of one mutation around an action. The first pass of the
 * feedback email checks everything the database can answer and then schedules the
 * action for the billing question, which needs Autumn, and for the welcome's thread,
 * which needs Resend. The action calls the mutation again with its verdict, which
 * re-checks the guards in the transaction that sends. The ledger row stays
 * `scheduled` in between, so only one pass can ever reach `sent`. The cancellation
 * email starts at its action, which admission schedules.
 */

/** Why a founder email was not sent, stored as the ledger row's `skippedReason`. */
export type FounderEmailSkipReason =
	| 'email_unavailable'
	| 'feature_disabled'
	| FounderRecipientSkipReason
	| 'admin'
	| 'empty_template'
	// Feedback email only: the billing verdict.
	| 'subscribed'
	| 'paid_before'
	// Feedback and cancellation email: Autumn could not answer.
	| 'billing_unknown'
	// Cancellation email only: the customer resumed or re-cancelled.
	| 'cancellation_reverted'
	// Cancellation email only: its switch went on again after the cancellation.
	| 'switched_on_after_cancellation'
	// A billing action could not hand its verdict back.
	| 'send_failed';

/** How many billing reads a cancellation email makes before it gives up on an unknown answer. */
export const FOUNDER_CANCELLATION_BILLING_ATTEMPTS = 3;

/** The wait before the next billing read, multiplied by the attempt that failed. */
export const FOUNDER_CANCELLATION_BILLING_BACKOFF_MS = 5 * 60 * 1000;

type FounderRecipient = { email: string; name?: string };

type GuardResult =
	| { ok: false; reason: FounderEmailSkipReason }
	| {
			ok: true;
			enabledAt: number;
			sender: FounderSender;
			recipient: FounderRecipient;
			template: FounderEmailTemplate;
	  };

/**
 * The checks every founder email beside the welcome shares, in the order their skip
 * reasons are recorded. `feature_disabled` means this email's switch is off or no
 * contact person is set. `recipientEmail` is the address the row was opened for.
 */
export async function checkFounderEmailGuards(
	ctx: MutationCtx,
	args: { userId: string; email: SwitchableFounderEmail; recipientEmail: string }
): Promise<GuardResult> {
	if (getEmailDeliveryConfiguration().state !== 'ready') {
		return { ok: false, reason: 'email_unavailable' };
	}
	const config = await readFounderEmailConfig(ctx, args.email);
	if (!config.enabled) return { ok: false, reason: 'feature_disabled' };

	const recipient = await checkFounderRecipient(ctx, {
		userId: args.userId,
		recipientEmail: args.recipientEmail,
		logContext: 'founderEmail'
	});
	if (!recipient.ok) return recipient;
	const { user } = recipient;
	if (user.role === 'admin') return { ok: false, reason: 'admin' };

	const template = config.template;
	if (!template.subject.trim() || !template.body.trim()) {
		return { ok: false, reason: 'empty_template' };
	}
	return {
		ok: true,
		enabledAt: config.enabledAt,
		sender: config.sender,
		recipient: { email: user.email, name: user.name },
		template
	};
}

/** Each founder email's `X-Email-Template`, mapped to its `X-Email-Category`. */
const FOUNDER_EMAIL_CATEGORIES = {
	'founder-feedback': 'onboarding',
	'founder-cancellation': 'lifecycle'
} as const;

/**
 * Render a founder template for one recipient and enqueue its text and HTML parts.
 * With a `thread`, the email replies to that message: it carries `In-Reply-To` and
 * `References` and takes the replied-to subject with `Re: `. Returns the component
 * email id and the subject sent.
 */
export async function sendFounderEmail(
	ctx: MutationCtx,
	args: {
		kind: keyof typeof FOUNDER_EMAIL_CATEGORIES;
		sender: FounderSender;
		recipient: FounderRecipient;
		template: FounderEmailTemplate;
		thread?: FounderThread;
	}
): Promise<{ emailId: string; subject: string }> {
	const emailConfiguration = assertResendApiKey();

	const parts = (args.recipient.name?.trim() || 'there').split(/\s+/);
	const vars = {
		userFirstName: parts[0] ?? '',
		userLastName: parts.slice(1).join(' '),
		founderName: args.sender.name,
		founderTitle: args.sender.title
	};
	const { text, html } = renderFounderEmail(args.template.body, vars);
	const subject = args.thread
		? `Re: ${args.thread.subject}`
		: renderFounderTemplate(args.template.subject, vars);

	const emailId = await resend.sendEmail(ctx, {
		from: `${args.sender.name} <${emailConfiguration.sender}>`,
		replyTo: args.sender.replyTo ? [args.sender.replyTo] : undefined,
		to: args.recipient.email,
		subject,
		text,
		html,
		headers: [
			{ name: 'X-Email-Category', value: FOUNDER_EMAIL_CATEGORIES[args.kind] },
			{ name: 'X-Email-Template', value: args.kind },
			...(args.thread
				? [
						{ name: 'In-Reply-To', value: args.thread.inReplyTo },
						{ name: 'References', value: args.thread.inReplyTo }
					]
				: [])
		]
	});
	return { emailId, subject };
}

export async function readSendRow(
	ctx: MutationCtx,
	sendId: Id<'founderEmailSends'>,
	email: Doc<'founderEmailSends'>['email']
) {
	const row = await ctx.db.get('founderEmailSends', sendId);
	return row?.email === email && row.status === 'scheduled' ? row : null;
}

export async function skipRow(
	ctx: MutationCtx,
	sendId: Id<'founderEmailSends'>,
	reason: FounderEmailSkipReason
): Promise<null> {
	await ctx.db.patch('founderEmailSends', sendId, { status: 'skipped', skippedReason: reason });
	return null;
}
