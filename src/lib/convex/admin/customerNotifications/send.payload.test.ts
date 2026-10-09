// @vitest-environment node
// The component double stores ArrayBuffer bodies, which Convex values only accept from this realm.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureEmail, installResend, setupSend } from './sendStore.fixtures';

/**
 * The payload bound, with a registry whose one source declares bounds large
 * enough for a valid presentation to outgrow the email limit. The template's
 * own sources cannot get there.
 */

vi.mock('../journey/registry', async () => {
	const { makeFunctionReference } = await import('convex/server');
	const { defineJourneySource } = await import('../journey/source');
	// The fixtures import this registry, so their constants cannot be imported here.
	const start = Date.UTC(2026, 9, 6, 9, 12);
	const minute = 60_000;
	const large = defineJourneySource({
		id: 'large',
		label: 'Large',
		read: makeFunctionReference<'query'>('test/large:read') as never,
		limits: { documentsRead: 10, bytesRead: 1024 },
		bounds: { steps: 60, linesPerStep: 10, line: 1000 },
		present: () => ({
			steps: Array.from({ length: 60 }, (_, index) => ({
				key: `large:${index}`,
				at: start + (index + 1) * minute,
				title: `Step ${index}`,
				lines: Array.from({ length: 10 }, () => 'x'.repeat(1000)),
				tone: 'neutral' as const
			})),
			metrics: []
		})
	});
	return { JOURNEY_SOURCES: [large] };
});

const functions = {
	'test/large:read': { _handler: async () => ({ coverage: { truncated: false } }) }
};

beforeEach(() => {
	configureEmail();
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

it('falls back to the email without a journey when the journey makes it too large', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	const { ledgerRow, send, row, enqueued } = setupSend({ functions });
	installResend();
	const id = ledgerRow();

	await send(id);

	const [email] = enqueued();
	expect(new TextEncoder().encode(email!.html).byteLength).toBeLessThanOrEqual(128 * 1024);
	expect(email!.text).toContain('The customer journey could not be included in this email.');
	expect(email!.text).not.toContain('Step 0');
	expect(email!.text).not.toContain('signup to paid');
	expect(row(id)).toMatchObject({ status: 'enqueued', enqueuedCount: 1 });
	expect(warn).toHaveBeenCalledWith(expect.objectContaining({ code: 'journey_payload_oversize' }));
});

it('fails a recipient before the component when even the fallback is too large', async () => {
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	const { ledgerRow, send, row } = setupSend({
		functions,
		customer: { name: 'A'.repeat(140 * 1024), email: 'big@example.com' }
	});
	const sendEmail = installResend();
	const id = ledgerRow();

	await send(id);

	expect(sendEmail).not.toHaveBeenCalled();
	expect(row(id)).toMatchObject({ status: 'failed', enqueuedCount: 0, failedCount: 1 });
	expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: 'email_payload_oversize' }));
});
