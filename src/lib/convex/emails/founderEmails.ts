import { v, type Infer } from 'convex/values';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import {
	checkFounderRecipient,
	readAuthUser,
	readFounderEmailConfig,
	type FounderEmailTemplate,
	type FounderRecipientSkipReason,
	type FounderSender,
	type SwitchableFounderEmail
} from './founderEmailConfig';
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

/**
 * The billing answer for the feedback email. `subscribed` is an active plan the
 * admin customer emails cover; `paid_before` is any paid invoice with a positive
 * total. `billing_unknown` covers every case where Autumn could not say no for
 * certain; the email is skipped rather than risk asking a customer why they did
 * not buy.
 */
export const founderFeedbackBillingValidator = v.union(
	v.literal('not_subscribed'),
	v.literal('subscribed'),
	v.literal('paid_before'),
	v.literal('billing_unknown')
);
export type FounderFeedbackBilling = Infer<typeof founderFeedbackBillingValidator>;

/**
 * The billing answer for the cancellation email: the customer's scheduled
 * cancellation as Autumn reports it now, `none` when Autumn reports none, and
 * `unknown` when the read failed or could not be trusted.
 */
export const founderCancellationBillingValidator = v.union(
	v.object({ cancellation: v.literal('scheduled'), canceledAt: v.number() }),
	v.object({ cancellation: v.literal('none') }),
	v.object({ cancellation: v.literal('unknown') })
);
export type FounderCancellationBilling = Infer<typeof founderCancellationBillingValidator>;

/** How many billing reads a cancellation email makes before it gives up on an unknown answer. */
export const FOUNDER_CANCELLATION_BILLING_ATTEMPTS = 3;

/** The wait before the next billing read, multiplied by the attempt that failed. */
const FOUNDER_CANCELLATION_BILLING_BACKOFF_MS = 5 * 60 * 1000;

/**
 * The welcome a feedback email replies to: its `Message-ID` in angle brackets and
 * its rendered subject.
 */
export const founderThreadValidator = v.object({ inReplyTo: v.string(), subject: v.string() });
export type FounderThread = Infer<typeof founderThreadValidator>;

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
async function checkFounderEmailGuards(
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
async function sendFounderEmail(
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

async function readSendRow(
	ctx: MutationCtx,
	sendId: Id<'founderEmailSends'>,
	email: Doc<'founderEmailSends'>['email']
) {
	const row = await ctx.db.get('founderEmailSends', sendId);
	return row?.email === email && row.status === 'scheduled' ? row : null;
}

async function skipRow(
	ctx: MutationCtx,
	sendId: Id<'founderEmailSends'>,
	reason: FounderEmailSkipReason
): Promise<null> {
	await ctx.db.patch('founderEmailSends', sendId, { status: 'skipped', skippedReason: reason });
	return null;
}

/**
 * One pass of the feedback email for a `founderEmailSends` row, scheduled by the
 * signup trigger. Without `billing` it runs the database guards and hands the
 * billing question to an action; with it, it sends only to a user the action found
 * definitively never to have paid, in the welcome's thread when the action found
 * one.
 */
export const sendFounderFeedbackEmail = internalMutation({
	args: {
		sendId: v.id('founderEmailSends'),
		billing: v.optional(founderFeedbackBillingValidator),
		thread: v.optional(founderThreadValidator)
	},
	returns: v.null(),
	handler: async (ctx, { sendId, billing, thread }) => {
		const row = await readSendRow(ctx, sendId, 'feedback');
		if (!row) return null;

		const guards = await checkFounderEmailGuards(ctx, {
			userId: row.userId,
			email: 'feedback',
			recipientEmail: row.recipientEmail
		});
		if (!guards.ok) return await skipRow(ctx, row._id, guards.reason);

		if (billing === undefined) {
			// Saved on the row so account deletion cancels the billing read too.
			const scheduledFnId = await ctx.scheduler.runAfter(
				0,
				internal.emails.founderEmailBilling.resolveFounderFeedbackBilling,
				{ sendId: row._id, userId: row.userId }
			);
			await ctx.db.patch('founderEmailSends', row._id, { scheduledFnId });
			return null;
		}
		if (billing !== 'not_subscribed') return await skipRow(ctx, row._id, billing);

		const { emailId, subject } = await sendFounderEmail(ctx, {
			kind: 'founder-feedback',
			sender: guards.sender,
			recipient: guards.recipient,
			template: guards.template,
			thread
		});
		await ctx.db.patch('founderEmailSends', row._id, {
			status: 'sent',
			sentAt: Date.now(),
			emailId,
			subject
		});
		return null;
	}
});

/**
 * Send the cancellation email for one `founderEmailSends` row, with the billing
 * verdict of `resolveFounderCancellationBilling`, which admission schedules for an
 * hour after the cancellation. Only a still-`scheduled` row is sent, to the address
 * it was opened for, and only while Autumn still reports the very cancellation the
 * row was opened for, as the action read it just before: a resumed or re-cancelled
 * subscription skips it, and so does a switch that went on again after the
 * cancellation. An unknown answer asks Autumn again a few minutes later,
 * up to {@link FOUNDER_CANCELLATION_BILLING_ATTEMPTS} reads in all.
 */
export const sendFounderCancellationEmail = internalMutation({
	args: {
		sendId: v.id('founderEmailSends'),
		attempt: v.number(),
		billing: founderCancellationBillingValidator
	},
	returns: v.null(),
	handler: async (ctx, { sendId, attempt, billing }) => {
		const row = await readSendRow(ctx, sendId, 'cancellation');
		if (!row) return null;

		const guards = await checkFounderEmailGuards(ctx, {
			userId: row.userId,
			email: 'cancellation',
			recipientEmail: row.recipientEmail
		});
		if (!guards.ok) return await skipRow(ctx, row._id, guards.reason);
		// Switched off and on again since admission: the cancellation now predates
		// the switch, which asks nobody who cancelled before it went on.
		if (guards.enabledAt > Number(row.dedupeKey)) {
			return await skipRow(ctx, row._id, 'switched_on_after_cancellation');
		}

		if (billing.cancellation === 'unknown') {
			if (attempt < FOUNDER_CANCELLATION_BILLING_ATTEMPTS) {
				const scheduledFnId = await ctx.scheduler.runAt(
					Date.now() + attempt * FOUNDER_CANCELLATION_BILLING_BACKOFF_MS,
					internal.emails.founderEmailBilling.resolveFounderCancellationBilling,
					{ sendId: row._id, userId: row.userId, attempt: attempt + 1 }
				);
				await ctx.db.patch('founderEmailSends', row._id, { scheduledFnId });
				return null;
			}
			console.warn({ code: 'founder_cancellation_billing_unknown' });
			return await skipRow(ctx, row._id, 'billing_unknown');
		}
		if (billing.cancellation === 'none' || String(billing.canceledAt) !== row.dedupeKey) {
			return await skipRow(ctx, row._id, 'cancellation_reverted');
		}

		const { emailId, subject } = await sendFounderEmail(ctx, {
			kind: 'founder-cancellation',
			sender: guards.sender,
			recipient: guards.recipient,
			template: guards.template
		});
		await ctx.db.patch('founderEmailSends', row._id, {
			status: 'sent',
			sentAt: Date.now(),
			emailId,
			subject
		});
		return null;
	}
});

/**
 * Record that a billing action could not hand its verdict back, so the row does not
 * stay `scheduled` forever. Only a still-`scheduled` row changes; a row that reached
 * `sent` or `skipped` before the failure keeps its outcome.
 */
export const recordFounderEmailSendFailure = internalMutation({
	args: { sendId: v.id('founderEmailSends') },
	returns: v.null(),
	handler: async (ctx, { sendId }) => {
		const row = await ctx.db.get('founderEmailSends', sendId);
		if (row?.status !== 'scheduled') return null;
		return await skipRow(ctx, sendId, 'send_failed');
	}
});

/**
 * Opt one user out of the personal founder emails (welcome, feedback, cancellation),
 * or back in. Every pending and future send to them then skips as `suppressed`.
 * Resend's suppression list would block all mail to the address team-wide,
 * password resets and invoices included; this blocks only founder mail, per user.
 * Idempotent; throws for a user id that does not exist. Operator-only:
 *
 *   bunx convex run emails/founderEmails:setPersonalEmailSuppression '{"userId":"<id>","suppressed":true}' --prod
 */
export const setPersonalEmailSuppression = internalMutation({
	args: { userId: v.string(), suppressed: v.boolean() },
	returns: v.null(),
	handler: async (ctx, { userId, suppressed }) => {
		if (!(await readAuthUser(ctx, userId))) throw new Error('User not found');
		const existing = await ctx.db
			.query('personalEmailSuppressions')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.unique();
		if (suppressed && !existing) {
			await ctx.db.insert('personalEmailSuppressions', { userId, createdAt: Date.now() });
		} else if (!suppressed && existing) {
			await ctx.db.delete('personalEmailSuppressions', existing._id);
		}
		return null;
	}
});
