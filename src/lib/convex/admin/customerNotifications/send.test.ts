// @vitest-environment node
// The component double stores ArrayBuffer bodies, which Convex values only accept from this realm.
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import de from '../../../../i18n/de.json';
import en from '../../../../i18n/en.json';
import es from '../../../../i18n/es.json';
import fr from '../../../../i18n/fr.json';
import { getRecipientsForNotificationType } from '../notificationPreferences/queries';
import {
	deactivateAdminPreferencesHelper,
	syncAdminPreferences
} from '../notificationPreferences/helpers';
import {
	CUSTOMER,
	DAY,
	ENQUEUE,
	HOUR,
	MINUTE,
	PAID,
	SIGNUP,
	configureEmail,
	installResend,
	setupSend,
	type Admin
} from './sendStore.fixtures';

type Registered = { _handler: (ctx: never, args: never) => Promise<unknown> };
const asRegistered = (fn: unknown) => fn as Registered;

/** Every console line the code under test wrote, as one string. */
function captureLogs() {
	const lines: string[] = [];
	for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
		vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
			lines.push(args.map((arg) => inspect(arg, { depth: 8 })).join(' '));
		});
	}
	return lines;
}

const fill = (message: string, params: Record<string, string>) =>
	message.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? `{${key}}`);

const admins = (...emails: string[]): Admin[] =>
	emails.map((email, index) => ({ id: `admin_${index}`, email }));

beforeEach(() => {
	configureEmail();
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe('new customer email from a seeded ledger row', () => {
	/** Free usage, a support contact, the payment, an event exactly at it and one after it. */
	function seedActivity(seed: ReturnType<typeof setupSend>['seed']) {
		seed.captureAll();
		for (const at of [SIGNUP + 6 * MINUTE, SIGNUP + HOUR, PAID - HOUR]) seed.receipt(at);
		seed.receipt(PAID);
		seed.receipt(PAID + HOUR);
		seed.message(SIGNUP + DAY);
		seed.message(SIGNUP + DAY + 2 * HOUR);
		seed.contact(PAID - 4 * HOUR - 25 * MINUTE);
	}

	it('shows what the customer did before paying and counts an event at the payment once', async () => {
		const { store, seed, ledgerRow, send, row, enqueued } = setupSend();
		seedActivity(seed);
		installResend();
		const id = ledgerRow();

		await send(id);

		const [email] = enqueued();
		expect(email?.subject).toBe('New customer: Ada Lovelace paid $10.00');
		const steps = email!.text.split('\n').filter((line) => /\(.*\d\d:\d\d\)$/.test(line));
		expect(steps).toEqual([
			'Signed up (Tue, Oct 6, 09:12)',
			'Sent 3 AI chat messages (09:18)',
			'Sent 2 community messages (Wed, Oct 7, 09:12)',
			'First recorded support contact (Thu, Oct 8, 10:05)',
			'Paid $10.00 (14:30)',
			// The event at the payment, once and after it; the one an hour later is outside the window.
			'Sent 1 AI chat message (14:30)'
		]);
		expect(email!.text).toContain('2 d 5 h: signup to paid');
		expect(email!.text).toContain('3: AI chat messages before paying');
		expect(email!.text).toContain('2: community messages before paying');
		expect(email!.html).toContain('Paid $10.00');
		expect(email!.html).toContain('Pro, monthly');

		const emails = store.docs('resend:emails');
		expect(row(id)).toMatchObject({
			status: 'enqueued',
			emailIds: emails.map((doc) => doc._id),
			enqueuedCount: 1,
			failedCount: 0
		});
		expect(emails[0]).toMatchObject({ to: ['owner@example.com'], subject: email!.subject });
	});

	it('also shows activity after the payment when the send waits for it', async () => {
		const { seed, ledgerRow, send, enqueued } = setupSend();
		seedActivity(seed);
		installResend();

		await send(ledgerRow({ postPaymentMs: 6 * HOUR }));

		const { text } = enqueued()[0]!;
		expect(text).toContain('Sent 3 AI chat messages (09:18)');
		expect(text).toContain('Sent 2 AI chat messages (14:30)\n  First 14:30, last 15:30');
		// The tile still counts what happened before paying.
		expect(text).toContain('3: AI chat messages before paying');
	});
});

describe('private data stays out of the email path', () => {
	const PRIVATE = ['PRIVATE-community-body', 'PRIVATE-support-text', 'PRIVATE-provider-text'];

	it.each([
		['every source loads', false],
		['a source read and one enqueue fail with private text', true]
	])('%s', async (_name, failing) => {
		const logs = captureLogs();
		const { store, seed, ledgerRow, send, row } = setupSend({
			admins: admins('owner@example.com', 'second@example.com'),
			functions: failing
				? {
						'admin/journey/sources/support:read': asRegistered({
							_handler: async () => {
								throw new Error(`read failed: ${PRIVATE[1]}`);
							}
						})
					}
				: {}
		});
		seed.captureAll();
		seed.message(SIGNUP + HOUR, PRIVATE[0]);
		seed.contact(SIGNUP + 2 * HOUR, PRIVATE[1]);
		installResend(failing ? { to: 'second@example.com', error: PRIVATE[2]! } : undefined);
		const id = ledgerRow();

		await send(id);

		const surfaces = [
			JSON.stringify(store.childArgs(ENQUEUE)),
			JSON.stringify(row(id)),
			JSON.stringify(store.docs('resend:emails')),
			logs.join('\n')
		];
		for (const surface of surfaces) {
			for (const sentinel of PRIVATE) expect(surface).not.toContain(sentinel);
		}
		expect(row(id)?.status).toBe('enqueued');
		if (failing) {
			expect(logs.join('\n')).toContain('journey_source_unavailable');
			expect(logs.join('\n')).toContain('email_enqueue_failed');
		}
	});
});

describe('recipients and outcomes', () => {
	it('treats a missing toggle as on and an explicit false as off, per type', async () => {
		const { store, preference, ledgerRow, send, enqueued } = setupSend({ admins: [] });
		preference('unset@example.com', { notifyNewCustomers: undefined });
		preference('off@example.com', { notifyNewCustomers: false });
		preference('on@example.com');
		installResend();

		await send(ledgerRow());

		expect(enqueued().map((email) => email.to)).toEqual(['unset@example.com', 'on@example.com']);
		const recipients = (type: string) =>
			store.mutate((ctx) =>
				asRegistered(getRecipientsForNotificationType)._handler(ctx as never, { type } as never)
			);
		expect(await recipients('newCustomers')).toEqual(['unset@example.com', 'on@example.com']);
		expect(await recipients('newSignups')).toEqual([
			'unset@example.com',
			'off@example.com',
			'on@example.com'
		]);
	});

	it('never sends to the preview admin, a demoted admin or a test address', async () => {
		const { preference, ledgerRow, send, enqueued } = setupSend({ admins: [] });
		preference('admin@preview.dev', { userId: 'preview' });
		preference('demoted@example.com', { userId: 'demoted', isAdminUser: false });
		preference('robot@e2e.example.com');
		preference('custom@example.com', { isAdminUser: false });
		installResend();

		await send(ledgerRow());

		expect(enqueued().map((email) => email.to)).toEqual(['custom@example.com']);
	});

	it('keeps an explicit choice through sync, re-promotion and custom-to-admin conversion', async () => {
		const { store, preference } = setupSend({ admins: [] });
		const sync = (userId: string, email: string) =>
			store.mutate((ctx) => syncAdminPreferences(ctx as never, { userId, email }));
		const toggle = (email: string) =>
			store.docs('adminNotificationPreferences').find((doc) => doc.email === email)
				?.notifyNewCustomers;

		await sync('fresh', 'fresh@example.com');
		await sync('preview', 'admin@preview.dev');
		expect(toggle('fresh@example.com')).toBe(true);
		expect(toggle('admin@preview.dev')).toBe(false);

		preference('chose@example.com', { userId: 'chose', notifyNewCustomers: false });
		await sync('chose', 'renamed@example.com');
		await store.mutate((ctx) => deactivateAdminPreferencesHelper(ctx as never, 'chose'));
		await sync('chose', 'renamed@example.com');
		expect(toggle('renamed@example.com')).toBe(false);

		preference('custom@example.com', { isAdminUser: false, notifyNewCustomers: false });
		await sync('converted', 'custom@example.com');
		const converted = store
			.docs('adminNotificationPreferences')
			.find((doc) => doc.email === 'custom@example.com');
		expect(converted).toMatchObject({ userId: 'converted', notifyNewCustomers: false });
	});

	it('skips a customer whose account is gone', async () => {
		const { store, ledgerRow, send, row } = setupSend();
		const sendEmail = installResend();
		const id = ledgerRow();
		store.deleteUser(CUSTOMER);

		await send(id);

		expect(row(id)).toMatchObject({ status: 'skipped', skippedReason: 'owner_deleted' });
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it('skips a test customer, unconfigured email and an empty audience', async () => {
		const testCustomer = setupSend({ customer: { email: 'buyer@e2e.example.com' } });
		const noAudience = setupSend({ admins: [] });
		const unconfigured = setupSend();
		const sendEmail = installResend();
		const ids = [testCustomer.ledgerRow(), noAudience.ledgerRow(), unconfigured.ledgerRow()];

		await testCustomer.send(ids[0]!);
		await noAudience.send(ids[1]!);
		vi.unstubAllEnvs();
		await unconfigured.send(ids[2]!);

		expect(testCustomer.row(ids[0]!)).toMatchObject({ skippedReason: 'test_customer' });
		expect(noAudience.row(ids[1]!)).toMatchObject({ skippedReason: 'no_recipients' });
		expect(unconfigured.row(ids[2]!)).toMatchObject({ skippedReason: 'email_unavailable' });
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it('rolls back only the recipient whose component enqueue crosses its write limit', async () => {
		const { store, ledgerRow, send, row } = setupSend({
			admins: admins('a@example.com', 'b@example.com', 'c@example.com')
		});
		installResend({ to: 'b@example.com', error: 'Transaction wrote too many bytes' });
		const id = ledgerRow();

		await send(id);

		const emails = store.docs('resend:emails');
		expect(emails.map((doc) => doc.to)).toEqual([['a@example.com'], ['c@example.com']]);
		// Two content records per committed email, none left from the failed one.
		expect(store.docs('resend:content')).toHaveLength(4);
		expect(row(id)).toMatchObject({
			status: 'enqueued',
			emailIds: emails.map((doc) => doc._id),
			enqueuedCount: 2,
			failedCount: 1
		});
	});

	it('fails the row when every enqueue fails', async () => {
		const { store, ledgerRow, send, row } = setupSend({ admins: admins('a@example.com') });
		installResend({ to: 'a@example.com', error: 'component unavailable' });
		const id = ledgerRow();

		await send(id);

		expect(row(id)).toMatchObject({ status: 'failed', enqueuedCount: 0, failedCount: 1 });
		expect(store.docs('resend:content')).toEqual([]);
	});

	it('sends to at most 20 recipients and flags the cut audience', async () => {
		const logs = captureLogs();
		const { ledgerRow, send, row, enqueued } = setupSend({
			admins: admins(...Array.from({ length: 21 }, (_, i) => `admin${i}@example.com`))
		});
		installResend();
		const id = ledgerRow();

		await send(id);

		expect(enqueued()).toHaveLength(20);
		expect(enqueued().map((email) => email.to)).not.toContain('admin20@example.com');
		expect(row(id)).toMatchObject({ status: 'enqueued', audienceTruncated: true });
		expect(logs.join('\n')).toContain('audience_truncated');
	});

	it('reports an incomplete scan that found nobody instead of an empty audience', async () => {
		const { preference, ledgerRow, send, row } = setupSend({ admins: [] });
		for (let i = 0; i < 500; i++) {
			preference(`off${i}@example.com`, { notifyNewCustomers: false });
		}
		preference('late@example.com');
		const sendEmail = installResend();
		const id = ledgerRow();

		await send(id);

		expect(row(id)).toMatchObject({
			status: 'skipped',
			skippedReason: 'audience_incomplete',
			audienceTruncated: true
		});
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it('fails the row when recipient discovery crosses its read limit', async () => {
		const { preference, ledgerRow, send, row } = setupSend({ admins: [] });
		// 400 rows of about 3 KB each read more than discovery's 1 MiB.
		for (let i = 0; i < 400; i++) {
			preference(`${'x'.repeat(3000)}${i}@example.com`, { notifyNewCustomers: false });
		}
		const sendEmail = installResend();
		const id = ledgerRow();

		await send(id);

		expect(row(id)).toMatchObject({ status: 'failed', failedReason: 'audience_unavailable' });
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it('reads each source once and hands each recipient only its rendered email', async () => {
		const { store, seed, ledgerRow, send, enqueued } = setupSend({
			admins: [
				{ id: 'admin_en', email: 'owner@example.com' },
				{ id: 'admin_de', email: 'max@example.com', locale: 'de' }
			]
		});
		seed.captureAll();
		seed.receipt(SIGNUP + HOUR);
		seed.message(SIGNUP + HOUR);
		installResend();

		await send(ledgerRow());

		const reads = store
			.queryCalls()
			.map((call) => call.name)
			.filter((name) => name.endsWith(':read'));
		expect(reads).toEqual([
			'admin/journey/sources/aiChat:read',
			'admin/journey/sources/community:read',
			'admin/journey/sources/support:read'
		]);
		for (const args of store.childArgs(ENQUEUE)) {
			expect(Object.keys(args).sort()).toEqual(['html', 'subject', 'template', 'text', 'to']);
			for (const value of Object.values(args)) expect(typeof value).toBe('string');
		}
		expect(enqueued().map((email) => email.subject)).toEqual([
			'New customer: Ada Lovelace paid $10.00',
			'Neuer Kunde: Ada Lovelace hat 10,00\u00a0$ bezahlt'
		]);
	});

	it('never sends a finished row again', async () => {
		const { store, ledgerRow, send, row } = setupSend();
		installResend();
		const id = ledgerRow();

		await send(id);
		const finished = row(id);
		await send(id);

		expect(store.docs('resend:emails')).toHaveLength(1);
		expect(row(id)).toEqual(finished);
	});
});

describe('new customer email rendering', () => {
	const COPY = { en, de, es, fr };
	const AMOUNTS = {
		en: '$10.00',
		de: '10,00\u00a0$',
		es: '10,00\u00a0US$',
		fr: '10,00\u00a0$US'
	};

	it('renders every locale in HTML and text', async () => {
		const customer = { name: `O'Brien <Ops>`, email: 'ops@example.com' };
		const { seed, ledgerRow, send, enqueued } = setupSend({
			customer,
			admins: (['en', 'de', 'es', 'fr'] as const).map((locale) => ({
				id: `admin_${locale}`,
				email: `${locale}@example.com`,
				locale
			}))
		});
		seed.captureAll();
		seed.receipt(SIGNUP + HOUR);
		installResend();

		await send(ledgerRow());

		for (const email of enqueued()) {
			const locale = email.to.split('@')[0] as keyof typeof COPY;
			const copy = COPY[locale].email;
			const params = { customer: customer.name, amount: AMOUNTS[locale], timeZone: 'UTC' };
			const milestone = copy.customer_journey.milestone;
			expect(email.subject).toBe(fill(copy.subject.new_customer, params));
			for (const text of [
				fill(copy.new_customer.title, params),
				copy.new_customer.badge,
				fill(copy.new_customer.footer, params),
				milestone.signed_up,
				fill(milestone.paid, params),
				fill(milestone.plan.month, { plan: 'Pro' })
			]) {
				expect(email.text).toContain(text);
			}
			expect(email.html).toContain(
				fill(copy.new_customer.title, { ...params, customer: 'O&#39;Brien &lt;Ops&gt;' })
			);
			expect(email.html).not.toContain('<Ops>');
		}
	});

	it('defines a dark rule for every dark class the journey uses', async () => {
		const { seed, ledgerRow, send, enqueued } = setupSend();
		seed.captureAll();
		seed.receipt(SIGNUP + HOUR);
		seed.contact(SIGNUP + 2 * HOUR);
		installResend();

		await send(ledgerRow());

		const { html } = enqueued()[0]!;
		const used = new Set(
			[...html.matchAll(/class="([^"]*)"/g)].flatMap((match) =>
				match[1]!.split(/\s+/).filter((name) => name.startsWith('dark_'))
			)
		);
		expect(used).toContain('dark_border-zinc-800');
		expect(used).toContain('dark_bg-zinc-700');
		for (const name of used) expect(html).toContain(`.${name} {`);
	});

	it.each([
		['absent', undefined],
		['invalid', 'Mars/Olympus_Mons']
	])('shows times in UTC when ADMIN_TIME_ZONE is %s', async (_name, zone) => {
		if (zone) vi.stubEnv('ADMIN_TIME_ZONE', zone);
		const { ledgerRow, send, enqueued } = setupSend();
		installResend();

		await send(ledgerRow());

		const { text } = enqueued()[0]!;
		expect(text).toContain('Signed up (Tue, Oct 6, 09:12)');
		expect(text).toContain('Paid $10.00 (Thu, Oct 8, 14:30)');
		expect(text).toContain('Times in UTC.');
	});

	it('shows times in ADMIN_TIME_ZONE across a daylight saving change', async () => {
		vi.stubEnv('ADMIN_TIME_ZONE', 'Europe/Berlin');
		const { ledgerRow, send, enqueued } = setupSend();
		installResend();

		// Berlin leaves summer time on Sun, Oct 25, 2026: 21:30 UTC is 23:30, 08:00 UTC is 09:00.
		await send(
			ledgerRow({
				signupAt: Date.UTC(2026, 9, 24, 21, 30),
				payment: { invoiceAt: Date.UTC(2026, 9, 26, 8, 0) }
			})
		);

		const { text } = enqueued()[0]!;
		expect(text).toContain('Signed up (Sat, Oct 24, 23:30)');
		expect(text).toContain('Paid $10.00 (Mon, Oct 26, 09:00)');
		expect(text).toContain('1 d 10 h: signup to paid');
		expect(text).toContain('Times in Europe/Berlin.');
	});
});
