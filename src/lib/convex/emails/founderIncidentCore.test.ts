import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFounderIncidentEmailMutation } from './founderIncidentCore';
import { defineFounderIncidentRegistry } from './founderIncidentTypes';
import { resend } from './resend';

type TestUser = {
	email: string;
	emailVerified?: boolean;
	locale?: string | null;
	name?: string;
} | null;

type Handler = {
	_handler: (
		ctx: unknown,
		args: { userId: string; incident: string }
	) => Promise<
		{ status: 'enqueued' } | { status: 'already_processed' } | { status: 'skipped'; reason: string }
	>;
};

function setup({
	contact = { name: 'Ada', replyTo: 'ada@example.com' } as {
		name: string;
		replyTo?: string;
	} | null,
	user = {
		email: 'affected@example.com',
		emailVerified: true,
		locale: 'de',
		name: 'Grace Hopper'
	} as TestUser,
	render = ({ locale, recipientName, senderName }: Record<string, string | undefined>) => ({
		subject: ` Restored for ${locale} `,
		text: `Hello ${recipientName} from ${senderName}`
	})
} = {}) {
	const registry = defineFounderIncidentRegistry({
		service_restored_2026_08_24: render
	});
	const mutation = createFounderIncidentEmailMutation({
		registry,
		resolveContact: async () => contact
	}) as unknown as Handler;
	const rows: Array<Record<string, unknown>> = [];
	const db = {
		query() {
			return {
				withIndex(_name: string, capture: (query: unknown) => unknown) {
					const filters: Record<string, unknown> = {};
					const query = {
						eq(field: string, value: unknown) {
							filters[field] = value;
							return query;
						}
					};
					capture(query);
					return {
						async unique() {
							return (
								rows.find((row) =>
									Object.entries(filters).every(([field, value]) => row[field] === value)
								) ?? null
							);
						}
					};
				}
			};
		},
		async insert(_table: string, row: Record<string, unknown>) {
			rows.push(row);
			return `incident_${rows.length}`;
		}
	};
	const ctx = {
		db,
		async runQuery() {
			return user;
		}
	};
	return { ctx, handler: mutation._handler, rows };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe('createFounderIncidentEmailMutation', () => {
	it('queues one localized plain-text email and records the component enqueue', async () => {
		vi.stubEnv('RESEND_API_KEY', 're_test');
		vi.stubEnv('AUTH_EMAIL', 'founder@example.com');
		const sendEmail = vi.spyOn(resend, 'sendEmail').mockResolvedValue('email_1' as never);
		const { ctx, handler, rows } = setup();
		const args = { userId: 'user_1', incident: 'service_restored_2026_08_24' };

		expect(await handler(ctx, args)).toEqual({ status: 'enqueued' });
		expect(await handler(ctx, args)).toEqual({ status: 'already_processed' });
		expect(sendEmail).toHaveBeenCalledTimes(1);
		expect(sendEmail).toHaveBeenCalledWith(ctx, {
			from: 'Ada <founder@example.com>',
			replyTo: ['ada@example.com'],
			to: 'affected@example.com',
			subject: 'Restored for de',
			text: 'Hello Grace Hopper from Ada',
			headers: [
				{ name: 'X-Email-Category', value: 'incident' },
				{ name: 'X-Email-Template', value: 'founder-incident' }
			]
		});
		expect(sendEmail.mock.calls[0]?.[1]).not.toHaveProperty('html');
		expect(rows).toEqual([
			expect.objectContaining({
				userId: 'user_1',
				incident: 'service_restored_2026_08_24',
				status: 'enqueued',
				emailId: 'email_1',
				locale: 'de',
				deliveryStatus: 'waiting'
			})
		]);
	});

	it.each([
		['user_deleted', { user: null }],
		['not_verified', { user: { email: 'affected@example.com', emailVerified: false } }],
		['test_email', { user: { email: 'run@e2e.example.com', emailVerified: true } }],
		['founder_not_configured', { contact: null }]
	] as const)('records the terminal %s exclusion without enqueueing', async (reason, options) => {
		const sendEmail = vi.spyOn(resend, 'sendEmail');
		const { ctx, handler, rows } = setup(options);

		expect(
			await handler(ctx, { userId: 'user_1', incident: 'service_restored_2026_08_24' })
		).toEqual({ status: 'skipped', reason });
		expect(sendEmail).not.toHaveBeenCalled();
		expect(rows).toEqual([expect.objectContaining({ status: 'skipped', skippedReason: reason })]);
	});

	it.each(['unknown', 'toString', '__proto__'])(
		'rejects the unregistered %s key before reading or writing',
		async (incident) => {
			const { ctx, handler, rows } = setup();
			const runQuery = vi.spyOn(ctx, 'runQuery');

			await expect(handler(ctx, { userId: 'user_1', incident })).rejects.toThrow(
				'Unknown founder incident key'
			);
			expect(runQuery).not.toHaveBeenCalled();
			expect(rows).toHaveLength(0);
		}
	);

	it.each([
		{ subject: '', text: 'Body' },
		{ subject: 'Broken\nsubject', text: 'Body' },
		{ subject: 'Subject', text: '   ' }
	])('rejects invalid rendered content before enqueueing', async (rendered) => {
		const sendEmail = vi.spyOn(resend, 'sendEmail');
		const { ctx, handler, rows } = setup({ render: () => rendered });

		await expect(
			handler(ctx, { userId: 'user_1', incident: 'service_restored_2026_08_24' })
		).rejects.toThrow('Invalid founder incident email content');
		expect(sendEmail).not.toHaveBeenCalled();
		expect(rows).toHaveLength(0);
	});

	it('falls back to the source locale before rendering', async () => {
		vi.stubEnv('RESEND_API_KEY', 're_test');
		vi.stubEnv('AUTH_EMAIL', 'founder@example.com');
		vi.spyOn(resend, 'sendEmail').mockResolvedValue('email_1' as never);
		const render = vi.fn(() => ({ subject: 'Restored', text: 'Body' }));
		const { ctx, handler } = setup({
			render,
			user: { email: 'affected@example.com', emailVerified: true, locale: 'xx' }
		});

		await handler(ctx, { userId: 'user_1', incident: 'service_restored_2026_08_24' });
		expect(render).toHaveBeenCalledWith(
			expect.objectContaining({ locale: 'en', senderName: 'Ada' })
		);
	});
});
