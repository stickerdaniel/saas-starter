import path from 'node:path';
import type { FunctionReference } from 'convex/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { freshSurfaceOf } from '../../../../scripts/convex-surface';
import { internal } from '../_generated/api';
import type { FounderWelcomeConfig } from '../admin/founderWelcome/queries';
import { founderIncidentRegistry } from './founderIncidentRegistry';
import { queueFounderIncidentEmail } from './founderIncidentSend';
import type { FounderIncidentQueueResult, FounderIncidentRenderer } from './founderIncidentTypes';
import { resend } from './resend';

const testIncident = '__application_binding_test__';
const generatedReference: FunctionReference<
	'mutation',
	'internal',
	{ userId: string; incident: string },
	FounderIncidentQueueResult
> = internal.emails.founderIncidentSend.queueFounderIncidentEmail;

type IncidentHandler = {
	_handler: (
		ctx: unknown,
		args: { userId: string; incident: string }
	) => Promise<FounderIncidentQueueResult>;
};

const handler = (queueFounderIncidentEmail as unknown as IncidentHandler)._handler;
const mutableRegistry = founderIncidentRegistry as Record<string, FounderIncidentRenderer>;

function registerTestIncident(): void {
	Object.assign(mutableRegistry, {
		[testIncident]: ({ senderName }) => ({
			subject: 'Service restored',
			text: `Sent by ${senderName}`
		})
	} satisfies Record<string, FounderIncidentRenderer>);
}

function makeCtx(config: FounderWelcomeConfig) {
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
		async runQuery(_reference: unknown, args: Record<string, unknown>) {
			if (args.model === 'user') {
				return {
					email: 'affected@example.com',
					emailVerified: true,
					name: 'Ada Lovelace'
				};
			}
			return config;
		}
	};
	return { ctx, rows };
}

afterEach(() => {
	delete mutableRegistry[testIncident];
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe('founder incident application binding', () => {
	it('publishes the internal single-recipient mutation', async () => {
		expect(generatedReference).toBeDefined();
		const surface = await freshSurfaceOf(path.resolve(__dirname, '..'));
		expect(surface.get('emails/founderIncidentSend:queueFounderIncidentEmail')).toEqual({
			kind: 'mutation',
			visibility: 'internal'
		});
	}, 20_000);

	it('rejects the reserved test key before database or auth access', async () => {
		const db = { query: vi.fn(), insert: vi.fn() };
		const runQuery = vi.fn();

		await expect(
			handler({ db, runQuery }, { userId: 'user_1', incident: testIncident })
		).rejects.toThrow('Unknown founder incident key');
		expect(db.query).not.toHaveBeenCalled();
		expect(db.insert).not.toHaveBeenCalled();
		expect(runQuery).not.toHaveBeenCalled();
	});

	it('maps the enabled founder contact into delivery', async () => {
		registerTestIncident();
		vi.stubEnv('RESEND_API_KEY', 're_test');
		vi.stubEnv('AUTH_EMAIL', 'founder@example.com');
		const sendEmail = vi.spyOn(resend, 'sendEmail').mockResolvedValue('email_1' as never);
		const { ctx } = makeCtx({
			enabled: true,
			contactUser: {
				id: 'founder_1',
				name: 'Grace Hopper',
				email: 'grace@example.com'
			},
			name: 'Grace',
			title: 'Founder',
			subject: 'Welcome',
			body: 'Welcome aboard',
			replyTo: 'grace@example.com'
		});

		await expect(handler(ctx, { userId: 'user_1', incident: testIncident })).resolves.toEqual({
			status: 'enqueued'
		});
		expect(sendEmail).toHaveBeenCalledWith(
			ctx,
			expect.objectContaining({
				from: 'Grace <founder@example.com>',
				replyTo: ['grace@example.com'],
				text: 'Sent by Grace'
			})
		);
	});

	it('maps a disabled founder contact to a terminal skip', async () => {
		registerTestIncident();
		const sendEmail = vi.spyOn(resend, 'sendEmail');
		const { ctx, rows } = makeCtx({ enabled: false });

		await expect(handler(ctx, { userId: 'user_1', incident: testIncident })).resolves.toEqual({
			status: 'skipped',
			reason: 'founder_not_configured'
		});
		expect(sendEmail).not.toHaveBeenCalled();
		expect(rows).toEqual([
			expect.objectContaining({
				incident: testIncident,
				status: 'skipped',
				skippedReason: 'founder_not_configured'
			})
		]);
	});
});
