import type { EmailId } from '@convex-dev/resend';
import { internal } from '../../convex/_generated/api';
import type { ActionCtx } from '../../convex/_generated/server';
import {
	readCustomerBilling,
	type CustomerBillingRead
} from '../admin/customerNotifications/autumnRead';
import { normalizeCustomerBilling } from '../admin/customerNotifications/billing';
import type {
	FounderCancellationBilling,
	FounderFeedbackBilling,
	FounderThread
} from './founderEmailTypes';
import { getEmailDeliveryConfiguration, resend } from './resend';

/**
 * The provider half of the feedback and cancellation emails. Each action answers
 * its billing question from one Autumn customer read, the one the admin customer
 * emails use (`autumnRead.ts`, normalized by `billing.ts`), and hands the verdict
 * back to the mutation that owns the ledger row. The feedback action also looks up
 * the welcome's thread in Resend. Both are scheduled only after the database
 * guards passed, so a skipped user costs no provider call.
 *
 * An action runs at most once, so a failed hand-back would leave the row
 * `scheduled` with nothing left to move it. The action records such a failure as
 * a `send_failed` skip instead.
 *
 * Logs carry a fixed code only, never provider responses or errors, which may
 * carry provider text.
 */

/** How long the welcome thread lookup may take in total, Resend's response body included. */
const WELCOME_THREAD_TIMEOUT_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a feedback-email recipient ever bought, from one customer read. An active
 * plan the admin customer emails cover is `subscribed`; any paid invoice with a
 * positive total, for any product, is `paid_before`. A customer Autumn does not
 * know has never paid. A failed read, or one the normalizer cannot trust, is
 * `billing_unknown`.
 *
 * Autumn returns only the newest invoices, so an old payment behind newer
 * zero-total invoices can hide; the worst outcome is one question to someone who
 * paid long ago.
 */
export function classifyFeedbackBilling(
	read: CustomerBillingRead,
	now: number
): FounderFeedbackBilling {
	if (read.kind === 'not_found') return 'not_subscribed';
	if (read.kind !== 'ok') return 'billing_unknown';
	const billing = normalizeCustomerBilling(read.data, now);
	if (billing.kind === 'malformed') return 'billing_unknown';
	if (billing.current !== null) return 'subscribed';
	// The normalizer accepted the read, so `invoices` is a list of records.
	const invoices: unknown[] =
		isRecord(read.data) && Array.isArray(read.data.invoices) ? read.data.invoices : [];
	const paid = invoices.some(
		(invoice) =>
			isRecord(invoice) &&
			invoice.status === 'paid' &&
			typeof invoice.total === 'number' &&
			invoice.total > 0
	);
	return paid ? 'paid_before' : 'not_subscribed';
}

/**
 * The welcome's `Message-ID`, from Resend's record of the sent welcome, and its
 * subject. Undefined when the user has no sent welcome; throws on everything else
 * that stops short of a usable id.
 */
async function readWelcomeThread(
	ctx: ActionCtx,
	userId: string,
	signal: AbortSignal
): Promise<FounderThread | undefined> {
	const welcome = await ctx.runQuery(internal.emails.founderEmailLedger.getSentFounderWelcome, {
		userId
	});
	if (!welcome) return undefined;
	// Null while the component has not handed the welcome to Resend yet.
	const resendId = (await resend.get(ctx, welcome.emailId as EmailId))?.resendId;
	const configuration = getEmailDeliveryConfiguration();
	if (!resendId || configuration.state !== 'ready') {
		throw new Error('welcome_not_addressable');
	}

	const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(resendId)}`, {
		headers: { Authorization: `Bearer ${configuration.value.apiKey}` },
		signal
	});
	if (!response.ok) throw new Error('resend_read_failed');
	const body: unknown = await response.json();
	const messageId = isRecord(body) ? body.message_id : undefined;
	// Accepted with or without angle brackets; anything else could break the header.
	const bare = typeof messageId === 'string' ? messageId.replace(/^<(.*)>$/, '$1') : '';
	if (!/^[^\s\p{Cc}<>@]+@[^\s\p{Cc}<>@]+$/u.test(bare)) throw new Error('message_id_malformed');
	return { inReplyTo: `<${bare}>`, subject: welcome.subject };
}

/**
 * The thread a feedback email replies in, or undefined to send it standalone. A
 * lookup that fails or outlasts {@link WELCOME_THREAD_TIMEOUT_MS} logs a coded
 * warning and never holds back the email.
 */
export async function findWelcomeThread(
	ctx: ActionCtx,
	userId: string
): Promise<FounderThread | undefined> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			reject(new Error('welcome_thread_timeout'));
		}, WELCOME_THREAD_TIMEOUT_MS);
	});
	try {
		return await Promise.race([readWelcomeThread(ctx, userId, controller.signal), timeout]);
	} catch {
		console.warn({ code: 'founder_feedback_thread_unavailable' });
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The customer's scheduled cancellation as Autumn reports it now. A customer Autumn
 * no longer has, or one without an active plan, has none to ask about; a failed
 * read or a record the normalizer cannot trust is unknown.
 */
export async function readScheduledCancellation(
	userId: string
): Promise<FounderCancellationBilling> {
	const read = await readCustomerBilling(userId);
	if (read.kind === 'not_found') return { cancellation: 'none' };
	if (read.kind !== 'ok') return { cancellation: 'unknown' };
	const billing = normalizeCustomerBilling(read.data, Date.now());
	if (billing.kind === 'malformed') return { cancellation: 'unknown' };
	const scheduled = billing.current?.scheduledCancellation;
	if (!scheduled) return { cancellation: 'none' };
	return { cancellation: 'scheduled', canceledAt: scheduled.canceledAt };
}
