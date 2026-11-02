// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components, internal } from '../_generated/api';
import payingScheduledCancelLink from '../admin/customerNotifications/__fixtures__/autumn/paying-scheduled-cancel-link.json';
import { normalizeCustomerBilling } from '../admin/customerNotifications/billing';
import authSchema from '../betterAuth/schema';
import schema from '../schema';
import {
	FOUNDER_CANCELLATION_DEFAULTS,
	FOUNDER_FEEDBACK_DEFAULTS,
	FOUNDER_WELCOME_DEFAULTS
} from './helpers';
import { resend } from './resend';

/**
 * The founder welcome, feedback and cancellation emails, end to end through the
 * signup triggers, billing admission, the real mutations, the scheduled billing
 * actions, and the ledger rows.
 *
 * Autumn is answered at its HTTP boundary (`autumnRead.ts` calls `fetch`) with the
 * template-shaped Link fixture of the admin customer emails, its times moved to the
 * test's clock. Resend's email record is the `GET /emails/{id}` example in Resend's
 * API reference, whose `message_id` carries its angle brackets.
 */

vi.mock('@gilhrpenner/convex-files-control', () => ({ registerRoutes: () => {} }));

// Vite keys this directory's own files as `./x.ts`; convex-test needs every module
// relative to the Convex root, so move them under `./emails/`.
const modules = Object.fromEntries(
	Object.entries(import.meta.glob('../**/*.ts')).map(([path, loader]) => [
		path.startsWith('../') ? path.replace(/^\.\.\//u, './') : path.replace(/^\.\//u, './emails/'),
		loader
	])
);
const betterAuthModules = import.meta.glob('../betterAuth/**/*.ts');
const harness = () => {
	const t = convexTest(schema, modules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	return t;
};
type Harness = ReturnType<typeof harness>;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RESEND_ID = '4ef9a417-02e9-4d39-ad75-9611e0fcc33c';
const MESSAGE_ID = '<111-222-333@email.example.com>';
const resendEmailRecord = {
	object: 'email',
	id: RESEND_ID,
	message_id: MESSAGE_ID,
	to: ['ada@example.com'],
	from: 'Sam <founder@example.com>',
	created_at: '2026-04-03 22:13:42.674981+00',
	subject: 'A quick hello',
	html: '<div>Hey Ada,</div>',
	text: null,
	bcc: [],
	cc: [],
	reply_to: [],
	last_event: 'delivered',
	scheduled_at: null,
	tags: []
};

/** The Link fixture's product, invoice and cancellation, moved so it is recent. */
const FIXTURE = payingScheduledCancelLink.data;
const [FIXTURE_PRODUCT] = FIXTURE.products;
const [FIXTURE_INVOICE] = FIXTURE.invoices;

type SentEmail = {
	from: string;
	replyTo?: string[];
	to: string;
	subject: string;
	text?: string;
	html?: string;
	headers?: Array<{ name: string; value: string }>;
};
let sent: SentEmail[] = [];
const network = vi.fn<typeof fetch>();
/** Autumn's customer endpoint, which the feedback and cancellation emails read. */
const AUTUMN_CUSTOMER = /^https:\/\/api\.useautumn\.com\/v1\/customers\//u;
const autumnCustomer = vi.fn<(url: string) => Promise<Response>>();

const founderSends = () =>
	sent.filter((email) =>
		email.headers?.some(
			(header) => header.name === 'X-Email-Template' && header.value.startsWith('founder-')
		)
	);
const template = (email: SentEmail | undefined) =>
	email?.headers?.find((header) => header.name === 'X-Email-Template')?.value;
const header = (email: SentEmail | undefined, name: string) =>
	email?.headers?.find((candidate) => candidate.name === name)?.value;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(FIXTURE_PRODUCT!.canceled_at + 10 * 60 * 1000);
	vi.stubEnv('RESEND_API_KEY', 're_test');
	vi.stubEnv('AUTH_EMAIL', 'founder@example.com');
	vi.stubEnv('EMAIL_ASSET_URL', 'https://assets.example.com');
	vi.stubEnv('AUTUMN_SECRET_KEY', 'am_sk_test_founder');
	vi.stubEnv('AUTUMN_WEBHOOK_SECRET', 'whsec_founder_test');
	sent = [];
	vi.spyOn(resend, 'sendEmail').mockImplementation(async (_ctx, options: unknown) => {
		sent.push(options as SentEmail);
		return `email_${sent.length}` as never;
	});
	// The component has handed every email it holds to Resend under RESEND_ID.
	vi.spyOn(resend, 'get').mockImplementation(async (_ctx, emailId) => {
		const email = sent[Number(String(emailId).replace('email_', '')) - 1];
		return (email ? { ...email, resendId: RESEND_ID } : null) as never;
	});
	vi.spyOn(resend, 'status').mockResolvedValue({ status: 'sent' } as never);
	vi.spyOn(resend, 'cancelEmail').mockResolvedValue(undefined);
	network.mockReset();
	network.mockImplementation(async (input) => {
		const url = input instanceof Request ? input.url : String(input);
		if (url === `https://api.resend.com/emails/${RESEND_ID}`) {
			return Response.json(resendEmailRecord);
		}
		if (AUTUMN_CUSTOMER.test(url)) return await autumnCustomer(url);
		throw new Error('Unexpected external transport in founder email test');
	});
	vi.stubGlobal('fetch', network);
	autumnCustomer.mockReset();
	autumnCustomer.mockResolvedValue(new Response(null, { status: 404 }));
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

/**
 * Run every scheduled function, and all the work it schedules, to completion,
 * counting only fake time: fire due timers, then wait as long as the started
 * functions take. `advanceTimers` bounds how far time moves.
 */
async function drainScheduled(t: Harness, advanceTimers: () => void = () => vi.runAllTimers()) {
	const running = Symbol('running');
	for (let round = 0; round < 100; round++) {
		advanceTimers();
		const settled = t.finishInProgressScheduledFunctions();
		if ((await Promise.race([settled, Promise.resolve(running)])) !== running) return;
		await settled;
	}
	throw new Error('scheduled functions were still rescheduling after 100 rounds');
}

/** Move fake time forward once, then run what that made due, without moving further. */
async function runFor(t: Harness, ms: number) {
	let first = true;
	await drainScheduled(t, () => {
		vi.advanceTimersByTime(first ? ms : 0);
		first = false;
	});
}

async function createUser(
	t: Harness,
	data: { name: string; email: string; role?: string; emailVerified?: boolean }
): Promise<string> {
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: { emailVerified: true, createdAt: now, updatedAt: now, ...data }
		}
	})) as { _id: string };
	return user._id;
}

async function readUser(t: Harness, userId: string) {
	return await t.query(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: '_id', operator: 'eq', value: userId }]
	});
}

/** A new account through the Better Auth create trigger, as a real signup runs it. */
async function signUp(
	t: Harness,
	data: { name: string; email: string; role?: string; emailVerified?: boolean } = {
		name: 'Ada Lovelace',
		email: 'ada@example.com'
	}
): Promise<string> {
	const userId = await createUser(t, data);
	await t.mutation(internal.auth.onCreate, { model: 'user', doc: await readUser(t, userId) });
	return userId;
}

/** Verify an email/password account, optionally under a changed address. */
async function verify(t: Harness, userId: string, update: { email?: string } = {}) {
	const oldDoc = await readUser(t, userId);
	await t.mutation(components.betterAuth.adapter.updateOne, {
		input: {
			model: 'user',
			where: [{ field: '_id', value: userId }],
			update: { emailVerified: true, ...update }
		}
	});
	await t.mutation(internal.auth.onUpdate, {
		model: 'user',
		oldDoc,
		newDoc: await readUser(t, userId)
	});
}

async function updateEmail(t: Harness, userId: string, email: string) {
	await t.mutation(components.betterAuth.adapter.updateOne, {
		input: { model: 'user', where: [{ field: '_id', value: userId }], update: { email } }
	});
}

async function deleteUser(t: Harness, userId: string) {
	const doc = await readUser(t, userId);
	await t.mutation(components.betterAuth.adapter.deleteOne, {
		input: { model: 'user', where: [{ field: '_id', value: userId }] }
	});
	await t.mutation(internal.auth.onDelete, { model: 'user', doc });
}

/** A signed-in client for an admin, for the admin settings functions. */
async function signIn(t: Harness, userId: string) {
	const now = Date.now();
	const session = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'session',
			data: {
				userId,
				token: crypto.randomUUID(),
				expiresAt: now + DAY_MS,
				createdAt: now,
				updatedAt: now
			}
		}
	})) as { _id: string };
	return t.withIdentity({ subject: userId, sessionId: session._id });
}

async function createAdmin(t: Harness, name = 'Sam Founder', email = 'sam@example.com') {
	return await createUser(t, { name, email, role: 'admin' });
}

type SwitchableEmail = 'feedback' | 'cancellation';

/** Save the welcome card as an admin, which makes them the contact person. */
async function becomeContact(
	t: Harness,
	adminId: string,
	overrides: Partial<{ name: string; title: string; replyTo: string }> = {}
) {
	const admin = await signIn(t, adminId);
	await admin.mutation(api.admin.founderWelcome.mutations.updateConfig, {
		name: 'Sam',
		title: 'Founder',
		subject: FOUNDER_WELCOME_DEFAULTS.subject,
		body: FOUNDER_WELCOME_DEFAULTS.body,
		...overrides
	});
}

async function setSwitch(t: Harness, adminId: string, email: SwitchableEmail, enabled: boolean) {
	const admin = await signIn(t, adminId);
	await admin.mutation(api.admin.founderWelcome.mutations.setFounderEmailEnabled, {
		email,
		enabled
	});
}

/** A new admin who becomes the contact person and switches the given emails on. */
async function contactWith(t: Harness, ...emails: SwitchableEmail[]): Promise<string> {
	const adminId = await createAdmin(t);
	await becomeContact(t, adminId);
	for (const email of emails) await setSwitch(t, adminId, email, true);
	return adminId;
}

async function suppress(t: Harness, userId: string, suppressed = true) {
	await t.mutation(internal.emails.founderEmails.setPersonalEmailSuppression, {
		userId,
		suppressed
	});
}

async function suppressionRows(t: Harness, userId: string) {
	return await t.run(async (ctx) =>
		// eslint-disable-next-line @convex-dev/no-collect-in-query -- Test: one user's opt-out rows in a convex-test backend
		ctx.db
			.query('personalEmailSuppressions')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.collect()
	);
}

async function sendRows(t: Harness, userId: string, email?: SwitchableEmail) {
	const rows = await t.run(async (ctx) =>
		// eslint-disable-next-line @convex-dev/no-collect-in-query -- Test: one user's ledger rows in a convex-test backend
		ctx.db
			.query('founderEmailSends')
			.withIndex('by_userId_and_email_and_dedupeKey', (q) => q.eq('userId', userId))
			.collect()
	);
	return email ? rows.filter((row) => row.email === email) : rows;
}

async function welcomeRows(t: Harness, userId: string) {
	return await t.run(async (ctx) =>
		// eslint-disable-next-line @convex-dev/no-collect-in-query -- Test: one user's ledger rows in a convex-test backend
		ctx.db
			.query('founderWelcomeEmails')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.collect()
	);
}

/** Pending jobs of the feedback and cancellation emails, without the welcome and admin notices. */
async function pendingFounderJobs(t: Harness) {
	const jobs = await t.run(async (ctx) => ctx.db.system.query('_scheduled_functions').take(50));
	return jobs.filter((job) => job.state.kind === 'pending' && job.name.includes('founderEmail'));
}

/** The Link fixture's customer, with its products and invoices replaced. */
function customer(overrides: { products?: unknown[]; invoices?: unknown[] } = {}) {
	return Response.json({ ...FIXTURE, ...overrides });
}

function invoice(total: number, status = 'paid', product = 'free') {
	return { ...FIXTURE_INVOICE, product_ids: [product], status, total };
}

const feedbackSends = () =>
	founderSends().filter((email) => template(email) === 'founder-feedback');

describe('founder welcome email', () => {
	it('welcomes signups as the contact person', async () => {
		const t = harness();
		await contactWith(t);
		const userId = await signUp(t);
		await drainScheduled(t);

		expect(founderSends().map(template)).toEqual(['founder-welcome']);
		expect(founderSends()[0]!.from).toBe('Sam <founder@example.com>');
		expect((await welcomeRows(t, userId))[0]).toMatchObject({ status: 'sent' });
	});

	it('skips a suppressed user', async () => {
		const t = harness();
		await contactWith(t);
		const userId = await signUp(t);
		await suppress(t, userId);
		await drainScheduled(t);

		expect(founderSends()).toEqual([]);
		expect((await welcomeRows(t, userId))[0]).toMatchObject({
			status: 'skipped',
			skippedReason: 'suppressed'
		});
	});

	it('stays off once the contact person steps down', async () => {
		const t = harness();
		const adminId = await contactWith(t);
		const admin = await signIn(t, adminId);
		await admin.mutation(api.admin.founderWelcome.mutations.stepDown, {});
		const userId = await signUp(t);
		await drainScheduled(t);

		expect(founderSends()).toEqual([]);
		expect(await welcomeRows(t, userId)).toEqual([]);
	});
});

describe('founder feedback email', () => {
	it('replies in the welcome thread 48 hours after an OAuth signup who never paid', async () => {
		const t = harness();
		await contactWith(t, 'feedback');
		const userId = await signUp(t);

		await runFor(t, 47 * HOUR_MS);
		expect(founderSends().map(template)).toEqual(['founder-welcome']);

		await drainScheduled(t);
		const [welcome, feedback] = founderSends();
		expect(template(feedback)).toBe('founder-feedback');
		expect(feedback!.to).toBe('ada@example.com');
		expect(feedback!.subject).toBe(`Re: ${welcome!.subject}`);
		expect(header(feedback, 'In-Reply-To')).toBe(MESSAGE_ID);
		expect(header(feedback, 'References')).toBe(MESSAGE_ID);
		expect(feedback!.text).toContain('Did you get stuck somewhere');
		expect((await sendRows(t, userId, 'feedback'))[0]).toMatchObject({
			status: 'sent',
			subject: `Re: ${welcome!.subject}`
		});
	});

	it('goes out as the contact person, like the welcome', async () => {
		const t = harness();
		const adminId = await createAdmin(t);
		await becomeContact(t, adminId, { name: 'Kim', replyTo: 'help@example.com' });
		await setSwitch(t, adminId, 'feedback', true);
		await signUp(t);
		await drainScheduled(t);

		const [welcome, feedback] = founderSends();
		for (const email of [welcome, feedback]) {
			expect(email!.from).toBe('Kim <founder@example.com>');
			expect(email!.replyTo).toEqual(['help@example.com']);
		}
	});

	it('sends the template the contact person saved', async () => {
		const t = harness();
		const adminId = await contactWith(t, 'feedback');
		const admin = await signIn(t, adminId);
		await admin.mutation(api.admin.founderWelcome.mutations.updateFounderEmailTemplate, {
			email: 'feedback',
			subject: 'Anything missing?',
			body: 'Hi {{userFirstName}}, what did you hope for?'
		});
		await signUp(t);
		await drainScheduled(t);

		expect(feedbackSends()[0]!.text).toBe('Hi Ada, what did you hope for?');
	});

	it('asks standalone when there is no welcome to reply to', async () => {
		const t = harness();
		await contactWith(t, 'feedback');
		const userId = await signUp(t);
		// A signup whose welcome never went out.
		await t.run(async (ctx) => {
			const welcome = await ctx.db
				.query('founderWelcomeEmails')
				.withIndex('by_user', (q) => q.eq('userId', userId))
				.unique();
			await ctx.db.delete('founderWelcomeEmails', welcome!._id);
		});
		await drainScheduled(t);

		const [feedback] = founderSends();
		expect(template(feedback)).toBe('founder-feedback');
		expect(feedback!.subject).toBe(FOUNDER_FEEDBACK_DEFAULTS.subject);
		expect(header(feedback, 'In-Reply-To')).toBeUndefined();
	});

	it('sends standalone when the welcome thread cannot be read', async () => {
		const t = harness();
		await contactWith(t, 'feedback');
		await signUp(t);
		network.mockImplementation(async (input) => {
			const url = input instanceof Request ? input.url : String(input);
			if (AUTUMN_CUSTOMER.test(url)) return await autumnCustomer(url);
			return new Response(null, { status: 500 });
		});
		await drainScheduled(t);

		const [feedback] = feedbackSends();
		expect(feedback!.subject).toBe(FOUNDER_FEEDBACK_DEFAULTS.subject);
		expect(header(feedback, 'In-Reply-To')).toBeUndefined();
	});

	it('waits for a password signup to verify, then asks 48 hours later', async () => {
		const t = harness();
		await contactWith(t, 'feedback');
		const userId = await signUp(t, {
			name: 'Ada Lovelace',
			email: 'ada@example.com',
			emailVerified: false
		});
		expect((await sendRows(t, userId, 'feedback'))[0]).toMatchObject({
			status: 'pending_verification'
		});

		vi.advanceTimersByTime(3 * DAY_MS);
		await verify(t, userId);
		await runFor(t, 47 * HOUR_MS);
		expect(feedbackSends()).toEqual([]);

		await drainScheduled(t);
		expect(feedbackSends()).toHaveLength(1);
	});

	it('skips the feedback email when the address changed before verification', async () => {
		const t = harness();
		await contactWith(t, 'feedback');
		const userId = await signUp(t, {
			name: 'Ada Lovelace',
			email: 'ada@example.com',
			emailVerified: false
		});
		await verify(t, userId, { email: 'ada@new.example.com' });
		await drainScheduled(t);

		expect(feedbackSends()).toEqual([]);
		expect((await sendRows(t, userId, 'feedback'))[0]).toMatchObject({
			status: 'skipped',
			skippedReason: 'email_changed'
		});
	});

	it.each([
		{
			case: 'an active subscription',
			read: () => customer({ products: [{ ...FIXTURE_PRODUCT, canceled_at: null }] }),
			reason: 'subscribed'
		},
		{
			case: 'a paid invoice with a positive total',
			read: () => customer({ products: [], invoices: [invoice(9)] }),
			reason: 'paid_before'
		},
		{
			case: 'an Autumn outage',
			read: () => new Response(null, { status: 503 }),
			reason: 'billing_unknown'
		},
		{
			case: 'a record the normalizer cannot trust',
			read: () => customer({ products: 'none' as never }),
			reason: 'billing_unknown'
		}
	])('skips a user with $case', async ({ read, reason }) => {
		const t = harness();
		await contactWith(t, 'feedback');
		autumnCustomer.mockImplementation(async () => read());
		const userId = await signUp(t);
		await drainScheduled(t);

		expect(feedbackSends()).toEqual([]);
		expect((await sendRows(t, userId, 'feedback'))[0]).toMatchObject({
			status: 'skipped',
			skippedReason: reason
		});
	});

	it('still asks a user whose only invoice was fully discounted', async () => {
		const t = harness();
		await contactWith(t, 'feedback');
		autumnCustomer.mockImplementation(async () =>
			customer({ products: [], invoices: [invoice(0, 'paid', 'pro')] })
		);
		await signUp(t);
		await drainScheduled(t);

		expect(feedbackSends()).toHaveLength(1);
	});

	it.each([
		{ case: 'an admin', data: { role: 'admin' }, reason: 'admin' },
		{ case: 'a test address', data: { email: 'ada@e2e.example.com' }, reason: 'test_email' }
	])('skips $case without asking Autumn', async ({ data, reason }) => {
		const t = harness();
		await contactWith(t, 'feedback');
		const userId = await signUp(t, { name: 'Ada Lovelace', email: 'ada@example.com', ...data });
		await drainScheduled(t);

		expect(autumnCustomer).not.toHaveBeenCalled();
		expect((await sendRows(t, userId, 'feedback'))[0]).toMatchObject({
			status: 'skipped',
			skippedReason: reason
		});
	});

	it('skips a suppressed user without asking Autumn', async () => {
		const t = harness();
		await contactWith(t, 'feedback');
		const userId = await signUp(t);
		await suppress(t, userId);
		await drainScheduled(t);

		expect(founderSends()).toEqual([]);
		expect(autumnCustomer).not.toHaveBeenCalled();
		expect((await sendRows(t, userId, 'feedback'))[0]).toMatchObject({
			status: 'skipped',
			skippedReason: 'suppressed'
		});
	});

	it('skips a row whose email was switched off before it was due', async () => {
		const t = harness();
		const adminId = await contactWith(t, 'feedback');
		const userId = await signUp(t);
		await setSwitch(t, adminId, 'feedback', false);
		await drainScheduled(t);

		expect(feedbackSends()).toEqual([]);
		expect((await sendRows(t, userId, 'feedback'))[0]).toMatchObject({
			status: 'skipped',
			skippedReason: 'feature_disabled'
		});
	});

	it('skips a row once the contact person stepped down', async () => {
		const t = harness();
		const adminId = await contactWith(t, 'feedback');
		const userId = await signUp(t);
		const admin = await signIn(t, adminId);
		await admin.mutation(api.admin.founderWelcome.mutations.stepDown, {});
		await drainScheduled(t);

		expect(founderSends()).toEqual([]);
		expect((await sendRows(t, userId, 'feedback'))[0]).toMatchObject({
			status: 'skipped',
			skippedReason: 'feature_disabled'
		});
	});

	it('records a send that fails after the billing answer', async () => {
		const t = harness();
		await contactWith(t, 'feedback');
		const userId = await signUp(t);
		vi.mocked(resend.sendEmail).mockRejectedValue(new Error('component down'));
		await drainScheduled(t);

		expect((await sendRows(t, userId, 'feedback'))[0]).toMatchObject({
			status: 'skipped',
			skippedReason: 'send_failed'
		});
	});

	it('reads nothing from Autumn for a row that is no longer waiting', async () => {
		const t = harness();
		await contactWith(t, 'feedback');
		const userId = await signUp(t);
		const [row] = await sendRows(t, userId, 'feedback');
		await t.run(async (ctx) => {
			await ctx.db.patch('founderEmailSends', row!._id, {
				status: 'skipped',
				skippedReason: 'feature_disabled'
			});
		});

		await t.action(internal.emails.founderEmailBilling.resolveFounderFeedbackBilling, {
			sendId: row!._id,
			userId
		});

		expect(network).not.toHaveBeenCalled();
	});

	it('opens no row while its switch is off', async () => {
		const t = harness();
		await contactWith(t);
		const userId = await signUp(t);

		expect(await sendRows(t, userId)).toEqual([]);
		expect(await pendingFounderJobs(t)).toEqual([]);
	});

	it('opens no row without a contact person, whatever the switch says', async () => {
		const t = harness();
		const adminId = await contactWith(t, 'feedback');
		const admin = await signIn(t, adminId);
		await admin.mutation(api.admin.founderWelcome.mutations.stepDown, {});
		const userId = await signUp(t);
		await drainScheduled(t);

		expect(await sendRows(t, userId)).toEqual([]);
		expect(founderSends()).toEqual([]);
	});
});

describe('founder cancellation email', () => {
	/** The paying customer of the Link fixture, under its own user id. */
	async function payingCustomer(
		t: Harness,
		data = { name: 'Ada Lovelace', email: 'ada@example.com' }
	) {
		return await createUser(t, data);
	}

	/** One billing webhook's admission, as `observe.ts` hands it over. */
	async function observe(t: Harness, userId: string, read = FIXTURE) {
		const observedAt = Date.now();
		const billing = normalizeCustomerBilling(read, observedAt);
		if (billing.kind !== 'observed') throw new Error(`fixture is ${billing.code}`);
		await t.mutation(internal.admin.customerNotifications.admission.admitObservation, {
			userId,
			firstPayment: billing.firstPayment,
			current: billing.current,
			observedAt
		});
	}

	/** Make a contact person who switches the email on before the fixture's cancellation. */
	async function enableBeforeCancellation(t: Harness): Promise<string> {
		const now = Date.now();
		vi.setSystemTime(FIXTURE_PRODUCT!.canceled_at - DAY_MS);
		const adminId = await contactWith(t, 'cancellation');
		vi.setSystemTime(now);
		return adminId;
	}

	beforeEach(() => {
		autumnCustomer.mockImplementation(async () => customer());
	});

	it('asks what was missing an hour after the cancellation', async () => {
		const t = harness();
		await enableBeforeCancellation(t);
		const userId = await payingCustomer(t);
		await observe(t, userId);

		await runFor(t, 40 * 60 * 1000);
		expect(founderSends()).toEqual([]);

		await drainScheduled(t);
		const [email] = founderSends();
		expect(template(email)).toBe('founder-cancellation');
		expect(email!.to).toBe('ada@example.com');
		expect(email!.from).toBe('Sam <founder@example.com>');
		expect(email!.subject).toBe(FOUNDER_CANCELLATION_DEFAULTS.subject);
		expect(header(email, 'X-Email-Category')).toBe('lifecycle');
		expect((await sendRows(t, userId, 'cancellation'))[0]).toMatchObject({
			status: 'sent',
			dedupeKey: String(FIXTURE_PRODUCT!.canceled_at)
		});
	});

	it('keeps the first switch-on time when switched on again', async () => {
		const t = harness();
		const adminId = await enableBeforeCancellation(t);
		await setSwitch(t, adminId, 'cancellation', true);
		const userId = await payingCustomer(t);
		await observe(t, userId);
		await drainScheduled(t);

		expect(founderSends().map(template)).toEqual(['founder-cancellation']);
	});

	it('opens one row for repeated observations of one cancellation', async () => {
		const t = harness();
		await enableBeforeCancellation(t);
		const userId = await payingCustomer(t);
		await observe(t, userId);
		await observe(t, userId);
		await drainScheduled(t);

		expect(await sendRows(t, userId, 'cancellation')).toHaveLength(1);
		expect(founderSends()).toHaveLength(1);
	});

	it('admits nothing for a cancellation first observed four hours late', async () => {
		const t = harness();
		await enableBeforeCancellation(t);
		const userId = await payingCustomer(t);
		vi.setSystemTime(FIXTURE_PRODUCT!.canceled_at + 4 * HOUR_MS);
		await observe(t, userId);

		expect(await sendRows(t, userId, 'cancellation')).toEqual([]);
	});

	it('asks nobody who cancelled before the email was switched on', async () => {
		const t = harness();
		await contactWith(t, 'cancellation');
		const userId = await payingCustomer(t);
		await observe(t, userId);

		expect(await sendRows(t, userId, 'cancellation')).toEqual([]);
	});

	it('admits nothing while its switch is off', async () => {
		const t = harness();
		const adminId = await enableBeforeCancellation(t);
		await setSwitch(t, adminId, 'cancellation', false);
		const userId = await payingCustomer(t);
		await observe(t, userId);

		expect(await sendRows(t, userId, 'cancellation')).toEqual([]);
	});

	it('admits nothing without a contact person', async () => {
		const t = harness();
		const adminId = await enableBeforeCancellation(t);
		const admin = await signIn(t, adminId);
		await admin.mutation(api.admin.founderWelcome.mutations.stepDown, {});
		const userId = await payingCustomer(t);
		await observe(t, userId);
		await drainScheduled(t);

		expect(await sendRows(t, userId, 'cancellation')).toEqual([]);
		expect(founderSends()).toEqual([]);
	});

	it('skips a suppressed customer', async () => {
		const t = harness();
		await enableBeforeCancellation(t);
		const userId = await payingCustomer(t);
		await suppress(t, userId);
		await observe(t, userId);
		await drainScheduled(t);

		expect(founderSends()).toEqual([]);
		expect((await sendRows(t, userId, 'cancellation'))[0]).toMatchObject({
			status: 'skipped',
			skippedReason: 'suppressed'
		});
	});

	it.each([
		{
			case: 'resumed',
			read: () => customer({ products: [{ ...FIXTURE_PRODUCT, canceled_at: null }] })
		},
		{
			case: 're-cancelled',
			read: () =>
				customer({
					products: [{ ...FIXTURE_PRODUCT, canceled_at: FIXTURE_PRODUCT!.canceled_at + 60_000 }]
				})
		}
	])('skips a customer who $case before the send', async ({ read }) => {
		const t = harness();
		await enableBeforeCancellation(t);
		const userId = await payingCustomer(t);
		await observe(t, userId);
		autumnCustomer.mockImplementation(async () => read());
		await drainScheduled(t);

		expect(founderSends()).toEqual([]);
		expect((await sendRows(t, userId, 'cancellation'))[0]).toMatchObject({
			status: 'skipped',
			skippedReason: 'cancellation_reverted'
		});
	});

	it('asks Autumn again after an unknown answer', async () => {
		const t = harness();
		await enableBeforeCancellation(t);
		const userId = await payingCustomer(t);
		await observe(t, userId);
		autumnCustomer
			.mockImplementationOnce(async () => new Response(null, { status: 503 }))
			.mockImplementation(async () => customer());
		await drainScheduled(t);

		expect(autumnCustomer).toHaveBeenCalledTimes(2);
		expect(founderSends().map(template)).toEqual(['founder-cancellation']);
	});

	it('gives up after three unknown answers', async () => {
		const t = harness();
		await enableBeforeCancellation(t);
		const userId = await payingCustomer(t);
		await observe(t, userId);
		autumnCustomer.mockImplementation(async () => new Response(null, { status: 503 }));
		await drainScheduled(t);

		expect(autumnCustomer).toHaveBeenCalledTimes(3);
		expect((await sendRows(t, userId, 'cancellation'))[0]).toMatchObject({
			status: 'skipped',
			skippedReason: 'billing_unknown'
		});
	});

	it('reads nothing from Autumn once the row is closed', async () => {
		const t = harness();
		await enableBeforeCancellation(t);
		const userId = await payingCustomer(t);
		await observe(t, userId);
		const [row] = await sendRows(t, userId, 'cancellation');
		await t.run(async (ctx) => {
			await ctx.db.patch('founderEmailSends', row!._id, {
				status: 'skipped',
				skippedReason: 'feature_disabled'
			});
		});

		await t.action(internal.emails.founderEmailBilling.resolveFounderCancellationBilling, {
			sendId: row!._id,
			userId,
			attempt: 2
		});

		expect(autumnCustomer).not.toHaveBeenCalled();
	});

	it('skips a customer whose address changed before the send', async () => {
		const t = harness();
		await enableBeforeCancellation(t);
		const userId = await payingCustomer(t);
		await observe(t, userId);
		await updateEmail(t, userId, 'ada@new.example.com');
		await drainScheduled(t);

		expect(founderSends()).toEqual([]);
		expect((await sendRows(t, userId, 'cancellation'))[0]).toMatchObject({
			status: 'skipped',
			skippedReason: 'email_changed'
		});
	});

	it('cancels a sent cancellation email the component still holds on account deletion', async () => {
		const t = harness();
		await enableBeforeCancellation(t);
		const userId = await payingCustomer(t);
		await observe(t, userId);
		await drainScheduled(t);
		const [row] = await sendRows(t, userId, 'cancellation');
		expect(row).toMatchObject({ status: 'sent' });
		vi.mocked(resend.status).mockResolvedValue({ status: 'waiting' } as never);

		await deleteUser(t, userId);

		expect(resend.cancelEmail).toHaveBeenCalledWith(expect.anything(), row!.emailId);
		expect(await sendRows(t, userId)).toEqual([]);
	});

	/** Switch the email off and on again, which starts it anew from now. */
	async function switchOffAndOn(t: Harness, adminId: string) {
		await setSwitch(t, adminId, 'cancellation', false);
		await setSwitch(t, adminId, 'cancellation', true);
	}

	it('skips a cancellation once the switch went off and on before the send', async () => {
		const t = harness();
		const adminId = await enableBeforeCancellation(t);
		const userId = await payingCustomer(t);
		await observe(t, userId);
		await switchOffAndOn(t, adminId);
		await drainScheduled(t);

		expect(founderSends()).toEqual([]);
		expect((await sendRows(t, userId, 'cancellation'))[0]).toMatchObject({
			status: 'skipped',
			skippedReason: 'switched_on_after_cancellation'
		});
	});

	it('skips a cancellation whose switch went off and on during a billing retry', async () => {
		const t = harness();
		const adminId = await enableBeforeCancellation(t);
		const userId = await payingCustomer(t);
		await observe(t, userId);
		autumnCustomer
			.mockImplementationOnce(async () => new Response(null, { status: 503 }))
			.mockImplementation(async () => customer());
		// The first read is due an hour after the cancellation and leaves a retry.
		await runFor(t, 50 * 60 * 1000);
		expect(autumnCustomer).toHaveBeenCalledTimes(1);
		expect((await sendRows(t, userId, 'cancellation'))[0]).toMatchObject({ status: 'scheduled' });

		await switchOffAndOn(t, adminId);
		await drainScheduled(t);

		expect(founderSends()).toEqual([]);
		expect((await sendRows(t, userId, 'cancellation'))[0]).toMatchObject({
			status: 'skipped',
			skippedReason: 'switched_on_after_cancellation'
		});
	});
});

describe('founder email settings', () => {
	it('lets only the contact person switch an email', async () => {
		const t = harness();
		await contactWith(t);
		const other = await signIn(t, await createAdmin(t, 'Kim Support', 'kim@example.com'));

		await expect(
			other.mutation(api.admin.founderWelcome.mutations.setFounderEmailEnabled, {
				email: 'feedback',
				enabled: true
			})
		).rejects.toThrow();
		const userId = await signUp(t);
		expect(await sendRows(t, userId)).toEqual([]);
	});

	it('lets only the contact person edit a template', async () => {
		const t = harness();
		await contactWith(t);
		const other = await signIn(t, await createAdmin(t, 'Kim Support', 'kim@example.com'));

		await expect(
			other.mutation(api.admin.founderWelcome.mutations.updateFounderEmailTemplate, {
				email: 'cancellation',
				subject: 'Hello',
				body: 'Hi'
			})
		).rejects.toThrow();
		const settings = await other.query(
			api.admin.founderWelcome.queries.getFounderEmailSettings,
			{}
		);
		expect(settings.cancellation.subject).toBe(FOUNDER_CANCELLATION_DEFAULTS.subject);
	});

	it('refuses switches while nobody is the contact person', async () => {
		const t = harness();
		const admin = await signIn(t, await createAdmin(t));

		await expect(
			admin.mutation(api.admin.founderWelcome.mutations.setFounderEmailEnabled, {
				email: 'feedback',
				enabled: true
			})
		).rejects.toThrow();
	});

	it.each([
		{ field: 'subject', value: ' ' },
		{ field: 'body', value: '' }
	])('refuses to save an empty $field', async ({ field, value }) => {
		const t = harness();
		const admin = await signIn(t, await contactWith(t));
		await expect(
			admin.mutation(api.admin.founderWelcome.mutations.updateFounderEmailTemplate, {
				email: 'feedback',
				subject: 'Hello',
				body: 'Hi',
				[field]: value
			})
		).rejects.toThrow();
	});

	it('shows the shared sender and who may edit', async () => {
		const t = harness();
		const contactId = await contactWith(t, 'feedback');
		const other = await signIn(t, await createAdmin(t, 'Kim Support', 'kim@example.com'));

		expect(
			await (
				await signIn(t, contactId)
			).query(api.admin.founderWelcome.queries.getFounderEmailSettings, {})
		).toMatchObject({
			sender: { name: 'Sam', title: 'Founder' },
			canEdit: true,
			feedback: { on: true },
			cancellation: { on: false }
		});
		expect(
			await other.query(api.admin.founderWelcome.queries.getFounderEmailSettings, {})
		).toMatchObject({ canEdit: false });
	});
});

describe('personal email suppression', () => {
	it('is idempotent and lets a user back in', async () => {
		const t = harness();
		await contactWith(t);
		const userId = await createUser(t, { name: 'Ada Lovelace', email: 'ada@example.com' });
		await suppress(t, userId);
		await suppress(t, userId);
		expect(await suppressionRows(t, userId)).toHaveLength(1);

		await suppress(t, userId, false);
		await suppress(t, userId, false);
		expect(await suppressionRows(t, userId)).toEqual([]);
	});

	it('refuses a user that does not exist', async () => {
		const t = harness();
		const userId = await createUser(t, { name: 'Ada Lovelace', email: 'ada@example.com' });
		await deleteUser(t, userId);

		await expect(suppress(t, userId)).rejects.toThrow('User not found');
	});
});

describe('founder emails on account deletion', () => {
	it('erases the rows and cancels the pending sends', async () => {
		const t = harness();
		await contactWith(t, 'feedback');
		const userId = await signUp(t);
		expect(await pendingFounderJobs(t)).toHaveLength(1);

		await deleteUser(t, userId);

		expect(await sendRows(t, userId)).toEqual([]);
		expect(await welcomeRows(t, userId)).toEqual([]);
		expect(await pendingFounderJobs(t)).toEqual([]);
	});

	it('cancels a sent welcome and feedback email the component still holds', async () => {
		const t = harness();
		await contactWith(t, 'feedback');
		const userId = await signUp(t);
		await drainScheduled(t);
		expect(founderSends().map(template)).toEqual(['founder-welcome', 'founder-feedback']);
		vi.mocked(resend.status).mockResolvedValue({ status: 'queued' } as never);

		await deleteUser(t, userId);

		expect(vi.mocked(resend.cancelEmail).mock.calls.map(([, emailId]) => emailId)).toEqual([
			'email_1',
			'email_2'
		]);
	});

	it('leaves a component email alone once Resend has it', async () => {
		const t = harness();
		await contactWith(t);
		const userId = await signUp(t);
		await drainScheduled(t);

		await deleteUser(t, userId);

		expect(resend.status).toHaveBeenCalledWith(expect.anything(), 'email_1');
		expect(resend.cancelEmail).not.toHaveBeenCalled();
		expect(await welcomeRows(t, userId)).toEqual([]);
	});

	it('erases a long cancellation history page by page', async () => {
		const t = harness();
		const userId = await createUser(t, { name: 'Ada Lovelace', email: 'ada@example.com' });
		const episodes = 120;
		await t.run(async (ctx) => {
			for (let index = 0; index < episodes; index++) {
				await ctx.db.insert('founderEmailSends', {
					userId,
					email: 'cancellation',
					dedupeKey: String(index),
					recipientEmail: 'ada@example.com',
					status: 'sent',
					emailId: `email_history_${index}`,
					subject: 'Sorry to see you go',
					createdAt: index
				});
			}
		});
		vi.mocked(resend.status).mockResolvedValue({ status: 'queued' } as never);

		await deleteUser(t, userId);
		expect((await sendRows(t, userId)).length).toBeGreaterThan(0);
		await drainScheduled(t);

		expect(await sendRows(t, userId)).toEqual([]);
		expect(resend.cancelEmail).toHaveBeenCalledTimes(episodes);
	});

	it('erases the opt-out', async () => {
		const t = harness();
		const userId = await createUser(t, { name: 'Ada Lovelace', email: 'ada@example.com' });
		await suppress(t, userId);

		await deleteUser(t, userId);

		expect(await suppressionRows(t, userId)).toEqual([]);
	});

	it('cancels a billing read that has not started yet', async () => {
		const t = harness();
		await contactWith(t, 'feedback');
		const userId = await signUp(t);
		const [row] = await sendRows(t, userId, 'feedback');
		// The 48-hour pass hands the billing question to its action.
		await t.mutation(internal.emails.founderEmails.sendFounderFeedbackEmail, { sendId: row!._id });
		const [handedOver] = await sendRows(t, userId, 'feedback');

		await deleteUser(t, userId);

		const job = await t.run(async (ctx) =>
			ctx.db.system.get('_scheduled_functions', handedOver!.scheduledFnId!)
		);
		expect(job?.name).toContain('resolveFounderFeedbackBilling');
		expect(job?.state.kind).toBe('canceled');
	});

	it('turns all three emails off when the contact person is deleted', async () => {
		const t = harness();
		const adminId = await contactWith(t, 'feedback', 'cancellation');

		await deleteUser(t, adminId);
		const userId = await signUp(t);
		await drainScheduled(t);

		expect(await sendRows(t, userId)).toEqual([]);
		expect(await welcomeRows(t, userId)).toEqual([]);
		const contact = await t.run(async (ctx) =>
			ctx.db
				.query('adminSettings')
				.withIndex('by_key', (q) => q.eq('key', 'founderWelcome.contactUserId'))
				.unique()
		);
		expect(contact).toBeNull();
	});

	it('keeps the rows of other users', async () => {
		const t = harness();
		await contactWith(t, 'feedback');
		const keptId = await signUp(t, { name: 'Grace Hopper', email: 'grace@example.com' });
		const deletedId = await signUp(t);

		await deleteUser(t, deletedId);

		expect(await sendRows(t, keptId)).toHaveLength(1);
	});
});
