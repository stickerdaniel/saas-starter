import { SchemaToValidator } from '@confect/core';
import { validate } from 'convex-helpers/validators';
import { v } from 'convex/values';
import * as Schema from 'effect/Schema';
import { describe, expect, it } from 'vitest';
import { UsageEventArgsSchema } from './schemas';

const model = { model: 'm', inputTokens: 1, outputTokens: 2, totalTokens: 3 };

describe('UsageEventArgs', () => {
	const native = v.object(SchemaToValidator.compileArgsSchema(UsageEventArgsSchema));

	it.each([
		{ feature: 'ai_chat', models: [] },
		{ feature: 'ai_chat_title', models: [model], userId: undefined, threadId: undefined },
		{
			feature: 'support_chat',
			userId: 'u1',
			threadId: 't1',
			status: 'partial',
			models: [
				{
					...model,
					provider: 'p',
					reasoningTokens: 0,
					cachedInputTokens: 1,
					nativeCostUsd: 0.5
				}
			]
		}
	])('decodes what its compiled validator accepts: %j', (value) => {
		expect(validate(native, value)).toBe(true);
		expect(() => Schema.decodeUnknownSync(UsageEventArgsSchema)(value)).not.toThrow();
	});

	it.each([
		{ feature: 'other', models: [] },
		{ feature: 'ai_chat', status: 'done', models: [] },
		{ feature: 'ai_chat', models: [{ model: 'm' }] }
	])('refuses in both forms: %j', (value) => {
		expect(validate(native, value)).toBe(false);
		expect(() => Schema.decodeUnknownSync(UsageEventArgsSchema)(value)).toThrow();
	});
});
