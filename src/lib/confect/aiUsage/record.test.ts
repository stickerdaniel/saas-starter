// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import type { FunctionArgs } from 'convex/server';
import { afterEach, describe, expect, it } from 'vitest';
import { internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import { convexModules } from '../convexTest.modules';
import { PRICES } from '../pricing/prices';

const PRICED = 'google/gemma-4-26b-a4b-it';
const UNPRICED = 'vendor/unpriced-model';
const PAID = 'vendor/paid-model';

const tokens = { inputTokens: 10, outputTokens: 4, totalTokens: 14 };
const native = { model: UNPRICED, ...tokens, nativeCostUsd: 0.25 };
const computed = { model: PRICED, ...tokens };
const unknown = { model: UNPRICED, ...tokens };

async function recorded(args: FunctionArgs<typeof internal.aiUsage.record.insert>) {
	const t = convexTest(schema, convexModules);
	await t.mutation(internal.aiUsage.record.insert, args);
	return await t.run(async (ctx) => await ctx.db.query('aiUsage').take(10));
}

describe('aiUsage/record:insert', () => {
	it.each([
		['native', [native], 0.25],
		['computed', [computed], 0],
		['unknown', [unknown], 0],
		['mixed', [native, computed], 0.25],
		['unknown', [native, unknown], 0.25]
	] as const)('stores the %s cost source for its models', async (source, models, costUsd) => {
		const [row] = await recorded({ feature: 'ai_chat', models: [...models] });
		expect(row).toMatchObject({ costSource: source, costUsd });
	});

	it('prices each model and sums tokens across them', async () => {
		const [row] = await recorded({
			feature: 'support_chat',
			userId: 'user_1',
			threadId: 'thread_1',
			status: 'partial',
			models: [
				{ ...native, provider: 'openrouter', reasoningTokens: 2 },
				{ ...computed, reasoningTokens: 1, cachedInputTokens: 3 }
			]
		});
		expect(row).toMatchObject({
			userId: 'user_1',
			threadId: 'thread_1',
			feature: 'support_chat',
			status: 'partial',
			inputTokens: 20,
			outputTokens: 8,
			totalTokens: 28,
			reasoningTokens: 3,
			cachedInputTokens: 3,
			models: [
				{
					...tokens,
					model: UNPRICED,
					provider: 'openrouter',
					reasoningTokens: 2,
					costUsd: 0.25,
					costSource: 'native'
				},
				{
					...tokens,
					model: PRICED,
					reasoningTokens: 1,
					cachedInputTokens: 3,
					costUsd: 0,
					costSource: 'computed'
				}
			]
		});
	});

	afterEach(() => {
		delete PRICES[PAID];
	});

	it('prices fresh input, cached input, text output and reasoning at their own rates', async () => {
		PRICES[PAID] = { in: 1, cachedIn: 3, out: 2, reasoning: 4 };
		const [row] = await recorded({
			feature: 'ai_chat',
			models: [
				{
					model: PAID,
					inputTokens: 1000,
					cachedInputTokens: 200,
					outputTokens: 500,
					reasoningTokens: 100,
					totalTokens: 1500
				},
				native
			]
		});
		expect(row).toMatchObject({
			costSource: 'mixed',
			costUsd: expect.closeTo(0.2526, 10),
			models: [
				{ costUsd: expect.closeTo(0.0026, 10), costSource: 'computed' },
				{ costUsd: 0.25, costSource: 'native' }
			]
		});
	});

	it('defaults the status and leaves absent fields out of the row', async () => {
		const [row] = await recorded({ feature: 'ai_chat_title', models: [unknown] });
		expect(row?.status).toBe('ok');
		expect(Object.keys(row ?? {}).sort()).toEqual(
			[
				'_creationTime',
				'_id',
				'at',
				'costSource',
				'costUsd',
				'feature',
				'inputTokens',
				'models',
				'outputTokens',
				'status',
				'totalTokens'
			].sort()
		);
		expect(Object.keys(row?.models[0] ?? {}).sort()).toEqual(
			['costSource', 'costUsd', 'inputTokens', 'model', 'outputTokens', 'totalTokens'].sort()
		);
	});
});
