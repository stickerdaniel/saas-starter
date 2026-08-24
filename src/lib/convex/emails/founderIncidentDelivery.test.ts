import type { EmailEvent, EmailId } from '@convex-dev/resend';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	applyFounderIncidentEmailEvent,
	mergeFounderIncidentDeliveryStatus,
	reconcileFounderIncidentEmailDelivery
} from './founderIncidentDelivery';
import { resend } from './resend';

type IncidentRow = {
	_id: string;
	userId: string;
	incident: string;
	status: 'enqueued' | 'skipped';
	emailId?: string;
	deliveryStatus?:
		| 'waiting'
		| 'queued'
		| 'sent'
		| 'delivery_delayed'
		| 'delivered'
		| 'bounced'
		| 'failed'
		| 'cancelled'
		| 'unknown';
	deliveryUpdatedAt?: number;
	complainedAt?: number;
};

function setup(row: IncidentRow | null) {
	const patches: Array<Record<string, unknown>> = [];
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
							if (!row) return null;
							return Object.entries(filters).every(([field, value]) =>
								field === 'emailId'
									? row.emailId === value
									: row[field as keyof IncidentRow] === value
							)
								? row
								: null;
						}
					};
				}
			};
		},
		async patch(_id: string, patch: Record<string, unknown>) {
			patches.push(patch);
			if (row) Object.assign(row, patch);
		}
	};
	return { ctx: { db, runQuery: vi.fn() }, patches, row };
}

function event(type: EmailEvent['type'], created_at = '2026-08-24T10:00:00.000Z'): EmailEvent {
	return { type, created_at, data: {} } as EmailEvent;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('Resend status contract', () => {
	it('returns the installed component snapshot or null without reshaping it', async () => {
		const snapshot = {
			status: 'delivered' as const,
			errorMessage: null,
			bounced: false,
			complained: true,
			failed: false,
			deliveryDelayed: false,
			opened: false,
			clicked: false
		};
		const runQuery = vi.fn().mockResolvedValueOnce(snapshot).mockResolvedValueOnce(null);
		const ctx = { runQuery };
		const emailId = 'email_1' as EmailId;

		expect(await resend.status(ctx as never, emailId)).toBe(snapshot);
		expect(await resend.status(ctx as never, emailId)).toBeNull();
		expect(runQuery).toHaveBeenCalledWith(resend.component.lib.getStatus, { emailId });
	});
});

describe('mergeFounderIncidentDeliveryStatus', () => {
	it('follows the component status precedence and keeps cancellation terminal', () => {
		expect(mergeFounderIncidentDeliveryStatus('waiting', 'sent')).toBe('sent');
		expect(mergeFounderIncidentDeliveryStatus('delivered', 'delivery_delayed')).toBe('delivered');
		expect(mergeFounderIncidentDeliveryStatus('delivered', 'bounced')).toBe('bounced');
		expect(mergeFounderIncidentDeliveryStatus('bounced', 'failed')).toBe('bounced');
		expect(mergeFounderIncidentDeliveryStatus('cancelled', 'delivered')).toBe('cancelled');
		expect(mergeFounderIncidentDeliveryStatus('unknown', 'queued')).toBe('queued');
		expect(mergeFounderIncidentDeliveryStatus('sent', 'unknown')).toBe('sent');
	});
});

describe('applyFounderIncidentEmailEvent', () => {
	it.each([
		['email.sent', 'sent'],
		['email.delivery_delayed', 'delivery_delayed'],
		['email.delivered', 'delivered'],
		['email.bounced', 'bounced'],
		['email.failed', 'failed']
	] as const)('records %s as %s', async (eventType, deliveryStatus) => {
		const { ctx, patches } = setup({
			_id: 'row_1',
			userId: 'user_1',
			incident: 'incident_1',
			status: 'enqueued',
			emailId: 'email_1',
			deliveryStatus: 'waiting'
		});

		await applyFounderIncidentEmailEvent(ctx as never, {
			id: 'email_1' as EmailId,
			event: event(eventType)
		});
		expect(patches).toEqual([
			{ deliveryStatus, deliveryUpdatedAt: Date.parse('2026-08-24T10:00:00.000Z') }
		]);
	});

	it('records a complaint without changing delivery status', async () => {
		const { ctx, patches } = setup({
			_id: 'row_1',
			userId: 'user_1',
			incident: 'incident_1',
			status: 'enqueued',
			emailId: 'email_1',
			deliveryStatus: 'delivered'
		});

		await applyFounderIncidentEmailEvent(ctx as never, {
			id: 'email_1' as EmailId,
			event: event('email.complained')
		});
		expect(patches).toEqual([{ complainedAt: Date.parse('2026-08-24T10:00:00.000Z') }]);
	});

	it.each(['email.opened', 'email.clicked'] as const)(
		'ignores %s for the incident row',
		async (type) => {
			const { ctx, patches } = setup({
				_id: 'row_1',
				userId: 'user_1',
				incident: 'incident_1',
				status: 'enqueued',
				emailId: 'email_1',
				deliveryStatus: 'delivered'
			});

			await applyFounderIncidentEmailEvent(ctx as never, {
				id: 'email_1' as EmailId,
				event: event(type)
			});
			expect(patches).toEqual([]);
		}
	);
});

describe('reconcileFounderIncidentEmailDelivery', () => {
	const handler = (reconcileFounderIncidentEmailDelivery as unknown as { _handler: unknown })
		._handler as (ctx: unknown, args: { userId: string; incident: string }) => Promise<unknown>;

	it('refreshes component state and preserves a recorded complaint', async () => {
		const { ctx, patches } = setup({
			_id: 'row_1',
			userId: 'user_1',
			incident: 'incident_1',
			status: 'enqueued',
			emailId: 'email_1',
			deliveryStatus: 'sent',
			complainedAt: 1
		});
		vi.spyOn(resend, 'status').mockResolvedValue({
			status: 'delivered',
			errorMessage: null,
			bounced: false,
			complained: false,
			failed: false,
			deliveryDelayed: false,
			opened: false,
			clicked: false
		});

		await expect(handler(ctx, { userId: 'user_1', incident: 'incident_1' })).resolves.toEqual({
			status: 'reconciled',
			deliveryStatus: 'delivered',
			complained: true
		});
		expect(patches).toEqual([
			expect.objectContaining({
				deliveryStatus: 'delivered',
				deliveryUpdatedAt: expect.any(Number)
			})
		]);
	});

	it.each([
		['not_found', null],
		[
			'skipped',
			{
				_id: 'row_1',
				userId: 'user_1',
				incident: 'incident_1',
				status: 'skipped'
			} satisfies IncidentRow
		]
	] as const)('returns %s without asking the component', async (status, row) => {
		const { ctx, patches } = setup(row);
		const componentStatus = vi.spyOn(resend, 'status');

		await expect(handler(ctx, { userId: 'user_1', incident: 'incident_1' })).resolves.toEqual({
			status
		});
		expect(componentStatus).not.toHaveBeenCalled();
		expect(patches).toEqual([]);
	});

	it('marks a nonterminal row unknown after component retention expires', async () => {
		const { ctx, patches } = setup({
			_id: 'row_1',
			userId: 'user_1',
			incident: 'incident_1',
			status: 'enqueued',
			emailId: 'email_1',
			deliveryStatus: 'sent'
		});
		vi.spyOn(resend, 'status').mockResolvedValue(null);

		await expect(handler(ctx, { userId: 'user_1', incident: 'incident_1' })).resolves.toEqual({
			status: 'reconciled',
			deliveryStatus: 'unknown',
			complained: false
		});
		expect(patches).toEqual([
			expect.objectContaining({ deliveryStatus: 'unknown', deliveryUpdatedAt: expect.any(Number) })
		]);
	});

	it('preserves a terminal row after component retention expires', async () => {
		const { ctx, patches } = setup({
			_id: 'row_1',
			userId: 'user_1',
			incident: 'incident_1',
			status: 'enqueued',
			emailId: 'email_1',
			deliveryStatus: 'delivered'
		});
		vi.spyOn(resend, 'status').mockResolvedValue(null);

		await expect(handler(ctx, { userId: 'user_1', incident: 'incident_1' })).resolves.toEqual({
			status: 'reconciled',
			deliveryStatus: 'delivered',
			complained: false
		});
		expect(patches).toEqual([]);
	});
});
