import { vi } from 'vitest';
import type { EmailId } from '@convex-dev/resend';
import { resend } from '../../emails/resend';
import { createJourneyStore } from '../journey/journeyStore.fixtures';
import * as aiChat from '../journey/sources/aiChat';
import * as community from '../journey/sources/community';
import * as support from '../journey/sources/support';
import { getJourneyRecipients } from '../notificationPreferences/queries';
import type { Payment } from './billing';
import { newCustomerEpisode } from './ledger';
import { enqueueRecipient, sendNewCustomer } from './send';

/**
 * A seeded deployment for the new-customer sender: the in-memory store with
 * every function the send path reaches, a ledger row as admission writes it,
 * and a Resend component double.
 *
 * The double writes what `@convex-dev/resend` 0.2.8 `lib.sendEmail` writes,
 * in the same order and inside the caller's transaction: one `content` record
 * per body (the UTF-8 bytes and a MIME type), then the `emails` row, whose id
 * it returns. It skips the batch worker the real mutation schedules.
 */

type Registered = { _handler: (ctx: never, args: never) => Promise<unknown> };
const asRegistered = (fn: unknown) => fn as Registered;

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const CUSTOMER = 'user_ada';
/** Tue, Oct 6, 09:12 UTC. */
export const SIGNUP = Date.UTC(2026, 9, 6, 9, 12);
/** Thu, Oct 8, 14:30 UTC: 2 d 5 h 18 min after signup. */
export const PAID = Date.UTC(2026, 9, 8, 14, 30);
export const PAYMENT: Payment = {
	invoiceAt: PAID,
	total: 10,
	currency: 'usd',
	planId: 'pro',
	interval: 'month'
};

export const SEND = 'admin/customerNotifications/send:sendNewCustomer';
export const ENQUEUE = 'admin/customerNotifications/send:enqueueRecipient';
const DISCOVERY = 'admin/notificationPreferences/queries:getJourneyRecipients';

export type Admin = { id: string; email: string; locale?: string };

export function setupSend(
	options: {
		admins?: Admin[];
		customer?: { name?: string; email: string };
		functions?: Record<string, Registered>;
	} = {}
) {
	const admins = options.admins ?? [{ id: 'admin_en', email: 'owner@example.com' }];
	const customer = options.customer ?? { name: 'Ada Lovelace', email: 'ada@example.com' };
	const store = createJourneyStore({
		users: [
			{ _id: CUSTOMER, ...customer },
			...admins.map(({ id, email, locale }) => ({ _id: id, email, locale }))
		],
		functions: {
			'admin/journey/sources/aiChat:read': asRegistered(aiChat.read),
			'admin/journey/sources/aiChat:countPartition': asRegistered(aiChat.countPartition),
			'admin/journey/sources/community:read': asRegistered(community.read),
			'admin/journey/sources/community:countPartition': asRegistered(community.countPartition),
			'admin/journey/sources/support:read': asRegistered(support.read),
			[DISCOVERY]: asRegistered(getJourneyRecipients),
			[ENQUEUE]: asRegistered(enqueueRecipient),
			[SEND]: asRegistered(sendNewCustomer),
			...options.functions
		}
	});
	let preferences = 0;
	for (const admin of admins) {
		preference(admin.email, { userId: admin.id });
	}

	/** One preference row, created after the ones before it. */
	function preference(
		email: string,
		overrides: Record<string, string | boolean | number | undefined> = {}
	) {
		const now = SIGNUP + preferences++;
		return store.insert(
			'adminNotificationPreferences',
			{
				email,
				isAdminUser: true,
				notifyNewSupportTickets: true,
				notifyUserReplies: true,
				notifyNewSignups: true,
				notifyNewCustomers: true,
				createdAt: now,
				updatedAt: now,
				...overrides
			},
			now
		);
	}

	/** The row admission writes for the customer's first payment. */
	function ledgerRow(
		options: { postPaymentMs?: number; signupAt?: number; payment?: Partial<Payment> } = {}
	) {
		const { postPaymentMs = 0, signupAt = SIGNUP } = options;
		const firstPayment = { ...PAYMENT, ...options.payment };
		const { episodeKey, request, sendAt } = newCustomerEpisode(
			{ userId: CUSTOMER, signupAt, firstPayment, now: firstPayment.invoiceAt },
			{ postPaymentMs }
		);
		return store.insert('customerNotifications', {
			userId: CUSTOMER,
			kind: 'new_customer',
			episodeKey,
			status: 'scheduled',
			billing: { firstPayment, current: { planId: firstPayment.planId, interval: 'month' } },
			request,
			observedAt: firstPayment.invoiceAt,
			sendAt
		});
	}

	let threads = 0;
	const seed = {
		captureAll(at = SIGNUP - DAY) {
			for (const source of ['aiChat', 'community', 'support']) {
				store.insert('journeyCaptureStarts', { source, startedAt: at });
			}
		},
		receipt(at: number) {
			store.insert('aiChatMessageReceipts', { userId: CUSTOMER }, at);
		},
		message(at: number, body = 'hello') {
			store.insert('messages', { userId: CUSTOMER, body, quotaSettledAt: at }, at);
		},
		contact(at: number, text = 'help') {
			store.insert(
				'supportThreads',
				{
					threadId: `thread_${threads++}`,
					userId: CUSTOMER,
					status: 'open',
					createdAt: at,
					updatedAt: at,
					firstUserMessageAt: at,
					title: text,
					lastMessage: text,
					searchText: text
				},
				at
			);
		}
	};

	/** Run the scheduled send for a ledger row as its own transaction. */
	const send = (notificationId: string) =>
		store.mutate(asRegistered(sendNewCustomer), { notificationId });

	const row = (id: string) => store.docs('customerNotifications').find((doc) => doc._id === id);

	/** What each recipient's child enqueue received, in send order. */
	const enqueued = () =>
		store.childArgs(ENQUEUE) as Array<{
			to: string;
			subject: string;
			html: string;
			text: string;
			template: string;
		}>;

	return { store, seed, preference, ledgerRow, send, row, enqueued };
}

/** Stub the email capability as configured, the way the deployment sets it. */
export function configureEmail() {
	vi.stubEnv('RESEND_API_KEY', 're_test');
	vi.stubEnv('AUTH_EMAIL', 'notify@example.com');
	vi.stubEnv('EMAIL_ASSET_URL', 'https://assets.example.com');
	vi.stubEnv('SITE_URL', 'https://app.example.com/');
}

type ComponentDb = { insert(table: string, value: Record<string, unknown>): Promise<string> };

/**
 * Replace the component enqueue with the double described above. `fail`
 * makes the enqueue for one address throw after its content records are
 * written, the way a write limit crossed by the email row does.
 */
export function installResend(fail?: { to: string; error: string }) {
	return vi.spyOn(resend, 'sendEmail').mockImplementation(async (ctx, options) => {
		if (typeof options === 'string') throw new Error('positional sendEmail is not modelled');
		const db = (ctx as unknown as { db: ComponentDb }).db;
		const content = async (body: string | undefined, mimeType: string) =>
			body === undefined
				? undefined
				: await db.insert('resend:content', {
						content: new TextEncoder().encode(body).buffer,
						mimeType
					});
		const html = await content(options.html, 'text/html');
		const text = await content(options.text, 'text/plain');
		const to = typeof options.to === 'string' ? [options.to] : options.to;
		if (fail && to.includes(fail.to)) throw new Error(fail.error);
		return (await db.insert('resend:emails', {
			from: options.from,
			to,
			subject: options.subject,
			html,
			text,
			headers: options.headers,
			status: 'waiting',
			replyTo: options.replyTo ?? []
		})) as EmailId;
	});
}
