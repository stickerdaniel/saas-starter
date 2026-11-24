import { SchemaToValidator } from '@confect/core';
import { validate } from 'convex-helpers/validators';
import { v } from 'convex/values';
import * as Schema from 'effect/Schema';
import { describe, expect, it } from 'vitest';
import {
	MigrationPageArgsSchema,
	MigrationProgressSchema,
	MigrationStartArgsSchema,
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
