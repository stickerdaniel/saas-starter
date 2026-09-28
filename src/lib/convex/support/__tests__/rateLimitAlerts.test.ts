import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import { MINUTE, HOUR } from '@convex-dev/rate-limiter';

const { sendEmail, getEmailDeliveryConfiguration } = vi.hoisted(() => ({
	sendEmail: vi.fn(),
	getEmailDeliveryConfiguration: vi.fn()
}));

const emailConfiguration = {
	apiKey: 'configured',
	sender: 'alerts@example.com',
	assetUrl: 'https://assets.example.com'
};

vi.mock('../../emails/resend', () => ({
	resend: { sendEmail },
	getEmailDeliveryConfiguration,
	assertResendApiKey: vi.fn(() => emailConfiguration)
}));

vi.mock('../../env', () => ({
	requireEnv: vi.fn(() => 'https://app.example.com'),
	requireEmailConfiguration: vi.fn(() => emailConfiguration)
}));

import { sampleAnonymousRateLimits } from '../rateLimitAlerts';
import { getRecipientsForNotificationType } from '../../admin/notificationPreferences/queries';

type Handler = { _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown> };
type Row = Record<string, unknown> & { _id: string };

type Preference = {
	email: string;
	userId?: string;
	isAdminUser: boolean;
	notifyNewSupportTickets: boolean;
	notifyUserReplies: boolean;
	notifyNewSignups: boolean;
};

const START = new Date('2026-09-27T08:00:00.000Z').getTime();
const RECIPIENTS_QUERY = 'admin/notificationPreferences/queries:getRecipientsForNotificationType';

/** Name of an application function reference; component references have none. */
function appFunctionName(ref: unknown): string | undefined {
	try {
		return getFunctionName(ref as never);
	} catch {
		return undefined;
	}
}

function preference(email: string, overrides: Partial<Preference> = {}): Preference {
	return {
		email,
		userId: `user_${email}`,
		isAdminUser: true,
		notifyNewSupportTickets: true,
		notifyUserReplies: true,
		notifyNewSignups: true,
		...overrides
	};
}

/**
 * Backend double for the cron, which reads the rate limits and sends the
 * alert in the same transaction. It has no scheduler, so a cron run that
 * tried to schedule anything would throw. Rate limit reads answer the component's `lib.getValue` the way
 * its handler does for a single-shard limit: the stored value and timestamp of
 * the row with that name and key, or the full capacity at ts 0 when there is
 * no row yet. Other component queries are Better Auth user lookups by email.
 */
function createBackend() {
	const limits = new Map<string, { key: string | undefined; value: number; ts: number }>();
	const tables: Record<string, Row[]> = {
		supportRateLimitAlerts: [],
		adminNotificationPreferences: []
	};
	const locales: Record<string, string> = {};
	let nextId = 1;

	const db = {
		query: (table: string) => {
			const rows = tables[table]!;
			return {
				collect: async () => [...rows],
				withIndex: (
					_index: string,
					range: (q: { eq: (field: string, value: unknown) => unknown }) => unknown
				) => {
					const equals: Record<string, unknown> = {};
					const q = {
						eq: (field: string, value: unknown) => {
							equals[field] = value;
							return q;
						}
					};
					range(q);
					const matches = rows.filter((row) =>
						Object.entries(equals).every(([field, value]) => row[field] === value)
					);
					return {
						unique: async () => {
							expect(matches.length, `${table} unique() matched several rows`).toBeLessThan(2);
							return matches[0] ?? null;
						}
					};
				}
			};
		},
		insert: vi.fn(async (table: string, doc: Record<string, unknown>) => {
			const row = { _id: `${table}_${nextId++}`, ...doc };
			tables[table]!.push(row);
			return row._id;
		}),
		patch: vi.fn(async (table: string, id: string, fields: Record<string, unknown>) => {
			const row = tables[table]!.find((candidate) => candidate._id === id)!;
			for (const [field, value] of Object.entries(fields)) {
				if (value === undefined) delete row[field];
				else row[field] = value;
			}
		})
	};

	const ctx = {
		db,
		runQuery: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
			if (appFunctionName(ref) === RECIPIENTS_QUERY) {
				return (getRecipientsForNotificationType as unknown as Handler)._handler({ db }, args);
			}
			if ('config' in args) {
				const config = args.config as { rate: number; capacity?: number };
				const full = { ...config, shards: 1, capacity: config.capacity ?? config.rate };
				const stored = limits.get(args.name as string);
				if (!stored || stored.key !== args.key) {
					return { value: full.capacity, ts: 0, shard: 0, config: full };
				}
				return { value: stored.value, ts: stored.ts, shard: 0, config: full };
			}
			const where = args.where as Array<{ value: string }>;
			return { locale: locales[where[0]!.value] ?? 'en' };
		})
	};

	return {
		tables,
		locales,
		/** What a `limit()` call leaves behind: the bucket's level at the current time. */
		setLevel(name: string, value: number, key: string | undefined = 'anonymous-global') {
			limits.set(name, { key, value, ts: Date.now() });
		},
		/** One cron run. */
		async tick() {
			await (sampleAnonymousRateLimits as unknown as Handler)._handler(ctx, {});
		},
		writes() {
			return db.insert.mock.calls.length + db.patch.mock.calls.length;
		}
	};
}

function advance(ms: number) {
	vi.setSystemTime(Date.now() + ms);
}

function sent() {
	return sendEmail.mock.calls.map(
		([, message]) => message as { to: string; subject: string; text: string }
	);
}

function alertedBuckets() {
	return sent().map(({ subject }) => subject.split(': ')[1]);
}

describe('support rate limit alerts', () => {
	let backend: ReturnType<typeof createBackend>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(START);
		getEmailDeliveryConfiguration.mockReturnValue({ state: 'ready', value: emailConfiguration });
		sendEmail.mockResolvedValue('email_1');
		backend = createBackend();
		backend.tables.adminNotificationPreferences!.push({
			_id: 'pref_1',
			...preference('ops@example.com')
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	/** Keeps a bucket drained through `samples` cron runs, 10 minutes apart. */
	async function drain(bucket: string, samples: number) {
		for (let run = 0; run < samples; run++) {
			backend.setLevel(bucket, 0);
			await backend.tick();
			advance(10 * MINUTE);
		}
	}

	it('stays silent and writes nothing while every bucket is below the threshold', async () => {
		// 30-token bucket with 7 left: 77% in use, just short of 80%.
		for (let run = 0; run < 3; run++) {
			backend.setLevel('supportThreadCreateAnon', 7);
			await backend.tick();
			advance(10 * MINUTE);
		}

		expect(sendEmail).not.toHaveBeenCalled();
		expect(backend.writes()).toBe(0);
	});

	it('emails once when a bucket stays past the threshold on consecutive samples', async () => {
		backend.setLevel('supportThreadCreateAnon', 4);
		await backend.tick();
		expect(sendEmail).not.toHaveBeenCalled();

		advance(10 * MINUTE);
		backend.setLevel('supportThreadCreateAnon', 4);
		await backend.tick();

		advance(10 * MINUTE);
		backend.setLevel('supportThreadCreateAnon', 1);
		await backend.tick();

		expect(sent().map(({ to, subject }) => ({ to, subject }))).toEqual([
			{ to: 'ops@example.com', subject: 'Support rate limit running low: New conversations' }
		]);
		const text = sent()[0]!.text.replace(/\s+/g, ' ');
		expect(text).toContain(
			'New conversations from signed-out visitors have used 87% of their shared limit for at least 10 minutes.'
		);
		expect(text).toContain('Remaining: 4 of 30');
		expect(text).toContain('Refill: 100 per hour');
		expect(text).toContain('at most one alert every 6 hours');
		expect(text).toContain('[https://app.example.com/admin/support]');
	});

	it('counts the refill since the last request when it reads a bucket', async () => {
		// Emptied 10 minutes before each sample: 100/hour refills ~16.7 of 30 by then.
		backend.setLevel('supportThreadCreateAnon', 0);
		advance(10 * MINUTE);
		await backend.tick();
		backend.setLevel('supportThreadCreateAnon', 0);
		advance(10 * MINUTE);
		await backend.tick();

		expect(sendEmail).not.toHaveBeenCalled();
	});

	it('ignores a single burst that refills before the next sample', async () => {
		backend.setLevel('supportFilePreviewAnon', 0);
		await backend.tick();
		advance(10 * MINUTE);
		await backend.tick();
		advance(10 * MINUTE);
		backend.setLevel('supportFilePreviewAnon', 0);
		await backend.tick();

		expect(sendEmail).not.toHaveBeenCalled();
	});

	it('suppresses repeat alerts for a bucket until the cooldown has passed', async () => {
		await drain('supportFileUploadAnon', 2);
		expect(alertedBuckets()).toEqual(['File uploads']);

		// Recovers, then drains again well inside the six hours.
		advance(HOUR);
		await backend.tick();
		await drain('supportFileUploadAnon', 3);
		// Another bucket is not held back by this one's cooldown.
		await drain('supportThreadCreateAnon', 2);
		expect(alertedBuckets()).toEqual(['File uploads', 'New conversations']);

		// Six hours after the first alert, a bucket that stays drained alerts again.
		vi.setSystemTime(START + 10 * MINUTE + 6 * HOUR);
		await drain('supportFileUploadAnon', 2);
		expect(alertedBuckets()).toEqual(['File uploads', 'New conversations', 'File uploads']);
	});

	it('only watches the shared anonymous bucket, not per-visitor keys', async () => {
		backend.setLevel('supportThreadCreateAnon', 0, 'anon_visitor');
		await backend.tick();
		advance(10 * MINUTE);
		await backend.tick();

		expect(sendEmail).not.toHaveBeenCalled();
	});

	it('starts the cooldown only once an alert reached someone', async () => {
		const preferences = backend.tables.adminNotificationPreferences!;
		preferences[0]!.notifyNewSupportTickets = false;

		// 08:00 and 08:10: low, but nobody has support ticket notifications on.
		await drain('supportThreadCreateAnon', 2);
		expect(sendEmail).not.toHaveBeenCalled();

		// Someone opts in; the next low sample sends right away.
		preferences[0]!.notifyNewSupportTickets = true;
		await drain('supportThreadCreateAnon', 1);
		expect(sent().map(({ to }) => to)).toEqual(['ops@example.com']);

		// That alert started the cooldown.
		await drain('supportThreadCreateAnon', 3);
		expect(sendEmail).toHaveBeenCalledTimes(1);
	});

	it('does not start the cooldown when email delivery is off', async () => {
		getEmailDeliveryConfiguration.mockReturnValue({ state: 'disabled' });
		await drain('supportThreadCreateAnon', 2);
		expect(sendEmail).not.toHaveBeenCalled();

		getEmailDeliveryConfiguration.mockReturnValue({ state: 'ready', value: emailConfiguration });
		await drain('supportThreadCreateAnon', 1);
		expect(sendEmail).toHaveBeenCalledTimes(1);
	});

	it('does not start the cooldown when the enqueue fails', async () => {
		sendEmail.mockRejectedValueOnce(new Error('enqueue failed'));
		await drain('supportThreadCreateAnon', 2);
		expect(sendEmail).toHaveBeenCalledTimes(1);

		await drain('supportThreadCreateAnon', 1);
		expect(sendEmail).toHaveBeenCalledTimes(2);
		await drain('supportThreadCreateAnon', 1);
		expect(sendEmail).toHaveBeenCalledTimes(2);
	});

	it('sends once when cron runs follow each other closely', async () => {
		backend.setLevel('supportThreadCreateAnon', 0);
		await backend.tick();
		advance(10 * MINUTE);
		backend.setLevel('supportThreadCreateAnon', 0);
		await backend.tick();
		advance(MINUTE);
		await backend.tick();

		expect(sendEmail).toHaveBeenCalledTimes(1);
	});

	it('writes only the low marker while email delivery is off', async () => {
		getEmailDeliveryConfiguration.mockReturnValue({ state: 'disabled' });
		await drain('supportThreadCreateAnon', 4);

		expect(sendEmail).not.toHaveBeenCalled();
		expect(backend.writes()).toBe(1);
		expect(backend.tables.supportRateLimitAlerts).toEqual([
			{ _id: expect.any(String), bucket: 'supportThreadCreateAnon', lowSince: START }
		]);
	});

	it('goes only to recipients with new support ticket notifications enabled', async () => {
		backend.tables.adminNotificationPreferences!.push(
			...[
				preference('off@example.com', { notifyNewSupportTickets: false }),
				preference('custom@example.com', { userId: undefined, isAdminUser: false }),
				preference('demoted@example.com', { isAdminUser: false }),
				preference('admin@preview.dev'),
				preference('robot@e2e.example.com')
			].map((row, index) => ({ _id: `pref_extra_${index}`, ...row }))
		);
		backend.locales['custom@example.com'] = 'de';
		await drain('supportThreadCreateAnon', 2);

		expect(sent().map(({ to, subject }) => ({ to, subject }))).toEqual([
			{ to: 'ops@example.com', subject: 'Support rate limit running low: New conversations' },
			{
				to: 'custom@example.com',
				subject: 'Support-Ratenlimit fast erreicht: Neue Unterhaltungen'
			}
		]);
	});
});
