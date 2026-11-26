import { Scheduler as ConfectScheduler, ConvexLogger } from '@confect/server';
import type { Scheduler as ConvexScheduler } from 'convex/server';
import { getFunctionName } from 'convex/server';
import * as Effect from 'effect/Effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordAiUsage } from './record.impl';

const MODEL = { model: 'model-a', inputTokens: 3, outputTokens: 2, totalTokens: 5 };

function schedulerDouble(runAfter: (...args: unknown[]) => Promise<string>) {
	const calls: Array<{ delayMs: number; name: string; args: unknown }> = [];
	const scheduler = {
		runAfter: async (
			delayMs: number,
			ref: Parameters<typeof getFunctionName>[0],
			args: unknown
		) => {
			calls.push({ delayMs, name: getFunctionName(ref), args });
			return await runAfter();
		},
		runAt: vi.fn(),
		cancel: vi.fn()
	} as unknown as ConvexScheduler;
	return { calls, layer: ConfectScheduler.layer(scheduler) };
}

const run = (
	effect: ReturnType<typeof recordAiUsage>,
	layer: ReturnType<typeof schedulerDouble>['layer']
) => Effect.runPromise(effect.pipe(Effect.provide([layer, ConvexLogger.layer])));

afterEach(() => {
	vi.restoreAllMocks();
});

describe('recordAiUsage', () => {
	it('schedules one usage insert at once with the call arguments', async () => {
		const { calls, layer } = schedulerDouble(async () => 'job_1');
		const args = {
			feature: 'ai_chat' as const,
			userId: 'user_1',
			threadId: 'thread_1',
			status: 'error' as const,
			models: [MODEL]
		};

		await run(recordAiUsage(args), layer);

		expect(calls).toEqual([{ delayMs: 0, name: 'aiUsage/record:insert', args }]);
	});

	it('schedules nothing when no model was used', async () => {
		const { calls, layer } = schedulerDouble(async () => 'job_1');

		await run(recordAiUsage({ feature: 'ai_chat_title', models: [] }), layer);

		expect(calls).toEqual([]);
	});

	it('logs a failed schedule and resolves', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { layer } = schedulerDouble(async () => {
			throw new Error('scheduler down');
		});

		await expect(
			run(recordAiUsage({ feature: 'support_chat', models: [MODEL] }), layer)
		).resolves.toBeUndefined();
		expect(error).toHaveBeenCalledWith({ code: 'ai_usage_record_failed', feature: 'support_chat' });
	});
});
