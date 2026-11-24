import { SchemaToValidator } from '@confect/core';
import { validate } from 'convex-helpers/validators';
import { v } from 'convex/values';
import * as Schema from 'effect/Schema';
import { describe, expect, it } from 'vitest';
import { SupportOwnerArgsSchema, ThreadReadArgsSchema } from './schemas';

const cases: ReadonlyArray<{
	name: string;
	schema: Schema.Codec<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
	accepted: readonly unknown[];
}> = [
	{
		name: 'SupportOwnerArgs',
		schema: SupportOwnerArgsSchema,
		accepted: [
			{},
			{ anonymousUserId: undefined },
			{ anonymousUserId: '' },
			{ anonymousUserId: 'x' }
		]
	},
	{
		name: 'ThreadReadArgs',
		schema: ThreadReadArgsSchema,
		accepted: [
			{ threadId: '', readThroughMessageId: '' },
			{ threadId: 't1', readThroughMessageId: 'm1', anonymousUserId: undefined },
			{ threadId: 't1', readThroughMessageId: 'm1', anonymousUserId: 'anon_1' }
		]
	}
];

describe.each(cases)('$name', ({ schema, accepted }) => {
	const native = v.object(SchemaToValidator.compileArgsSchema(schema));

	it.each(accepted)('decodes what its compiled validator accepts: %j', (value) => {
		expect(validate(native, value)).toBe(true);
		expect(() => Schema.decodeUnknownSync(schema)(value)).not.toThrow();
	});
});
