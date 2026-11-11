import type { EmailEvent, EmailId } from '@convex-dev/resend';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleEmailEvent } from './events';

const handler = (handleEmailEvent as unknown as { _handler: unknown })._handler as (
	ctx: unknown,
	args: { id: EmailId; event: EmailEvent }
) => Promise<null>;

const PROVIDER_TEXT = 'mailbox alice@example.com does not exist';

function setup() {
	const inserts: Array<Record<string, unknown>> = [];
	const db = {
		query: () => ({ withIndex: () => ({ unique: async () => null }) }),
		insert: async (_table: string, row: Record<string, unknown>) => {
			inserts.push(row);
		}
	};
	return { ctx: { db }, inserts };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('handleEmailEvent', () => {
	it.each([
		[
			'email.bounced',
			{ bounce: { message: PROVIDER_TEXT, subType: 'General', type: 'Permanent' } }
		],
		['email.failed', { failed: { reason: PROVIDER_TEXT } }]
	] as const)('stores %s and keeps its provider text out of the logs', async (type, details) => {
		const logged = [
			vi.spyOn(console, 'log').mockImplementation(() => {}),
			vi.spyOn(console, 'warn').mockImplementation(() => {})
		];
		const event = {
			type,
			created_at: '2026-11-11T10:00:00.000Z',
			data: { email_id: 'resend_1', to: ['alice@example.com'], subject: 'Welcome', ...details }
		} as unknown as EmailEvent;
		const { ctx, inserts } = setup();

		await handler(ctx, { id: 'email_1' as EmailId, event });

		expect(inserts).toMatchObject([{ emailId: 'email_1', eventType: type, data: event }]);
		expect(JSON.stringify(logged.map((spy) => spy.mock.calls))).not.toContain('alice@example.com');
	});
});
