import { SchemaToValidator } from '@confect/core';
import { validate } from 'convex-helpers/validators';
import { v } from 'convex/values';
import * as Schema from 'effect/Schema';
import { describe, expect, it } from 'vitest';
import { AiChatRefusal, AiChatRefusalCodec } from '../errorCodecs';
import { AI_CHAT_ERROR_CODES } from './errors';
import {
	MigrationPageArgsSchema,
	MigrationProgressSchema,
	MigrationStartArgsSchema,
	ThreadListArgsSchema,
	ThreadMetadataArgsSchema,
	ThreadRefSchema,
	ThreadTitleArgsSchema,
	TitleArgsSchema
} from './schemas';

const cases: ReadonlyArray<{
	name: string;
	schema: Schema.Codec<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
	accepted: readonly unknown[];
	refused: readonly unknown[];
}> = [
	{
		name: 'MigrationStartArgs',
		schema: MigrationStartArgsSchema,
		accepted: [{}, { restart: undefined }, { restart: true }],
		refused: [{ restart: 'yes' }]
	},
	{
		name: 'MigrationPageArgs',
		schema: MigrationPageArgsSchema,
		accepted: [
			{ id: 'k1', cursor: null },
			{ id: 'k1', cursor: '' }
		],
		refused: [{ id: 'k1' }]
	},
	{
		name: 'TitleArgs',
		schema: TitleArgsSchema,
		accepted: [
			{ threadId: '', prompt: '' },
			{ threadId: 't1', prompt: 'p', userId: undefined },
			{ threadId: 't1', prompt: 'p', userId: 'u1' }
		],
		refused: [{ threadId: 't1' }]
	},
	{
		name: 'ThreadListArgs',
		schema: ThreadListArgsSchema,
		accepted: [{}, { limit: undefined }, { limit: 0 }, { limit: 2.5 }],
		refused: [{ limit: '10' }]
	},
	{
		name: 'ThreadRef',
		schema: ThreadRefSchema,
		accepted: [{ threadId: '' }, { threadId: 't1' }],
		refused: [{}]
	},
	{
		name: 'ThreadMetadataArgs',
		schema: ThreadMetadataArgsSchema,
		accepted: [
			{ threadId: 't1' },
			{ threadId: 't1', lastMessage: undefined, lastMessageAt: undefined },
			{ threadId: 't1', lastMessage: '', lastMessageAt: 0 }
		],
		refused: [{ threadId: 't1', lastMessageAt: 'now' }]
	},
	{
		name: 'ThreadTitleArgs',
		schema: ThreadTitleArgsSchema,
		accepted: [{ threadId: 't1', title: '' }],
		refused: [{ threadId: 't1' }]
	}
];

describe.each(cases)('$name', ({ schema, accepted, refused }) => {
	const native = v.object(SchemaToValidator.compileArgsSchema(schema));

	it.each(accepted)('decodes what its compiled validator accepts: %j', (value) => {
		expect(validate(native, value)).toBe(true);
		expect(() => Schema.decodeUnknownSync(schema)(value)).not.toThrow();
	});

	it.each(refused)('refuses in both forms: %j', (value) => {
		expect(validate(native, value)).toBe(false);
		expect(() => Schema.decodeUnknownSync(schema)(value)).toThrow();
	});
});

describe('MigrationProgress', () => {
	it.each([
		{ version: 1, status: 'running', processed: 0 },
		{ version: 1, status: 'complete', processed: 205 }
	])('decodes a progress value: %j', (value) => {
		expect(Schema.decodeUnknownSync(MigrationProgressSchema)(value)).toEqual(value);
	});

	it.each([
		{ version: 2, status: 'running', processed: 0 },
		{ version: 1, status: 'failed', processed: 0 }
	])('refuses a value outside the progress shape: %j', (value) => {
		expect(() => Schema.decodeUnknownSync(MigrationProgressSchema)(value)).toThrow();
	});
});

describe('AiChatRefusal', () => {
	it.each([
		{ code: AI_CHAT_ERROR_CODES.threadNotFound },
		{ code: AI_CHAT_ERROR_CODES.messageTooLong, maxLength: 4000 }
	])('keeps the wire data of %j', (refusal) => {
		const encoded = Schema.encodeSync(AiChatRefusalCodec)(new AiChatRefusal({ refusal }));
		expect(encoded).toEqual(refusal);
		expect(Schema.decodeUnknownSync(AiChatRefusalCodec)(encoded).refusal).toEqual(refusal);
	});

	it.each([{ code: AI_CHAT_ERROR_CODES.messageTooLong }, { code: 'AI_CHAT_OTHER' }])(
		'refuses wire data outside the refusal set: %j',
		(value) => {
			expect(() => Schema.decodeUnknownSync(AiChatRefusalCodec)(value)).toThrow();
		}
	);
});
