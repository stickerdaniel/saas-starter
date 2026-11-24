import { SchemaToValidator } from '@confect/core';
import { validate } from 'convex-helpers/validators';
import { v } from 'convex/values';
import * as Schema from 'effect/Schema';
import { describe, expect, it } from 'vitest';
import {
	AttachmentTextArgsSchema,
	PromptActivationArgsSchema,
	PromptLocaleArgsSchema,
	SavePromptArgsSchema,
	SupportOwnerArgsSchema,
	ThreadReadArgsSchema,
	TicketMigrationArgsSchema,
	UploadRegistrationArgsSchema
} from './schemas';

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
	},
	{
		name: 'TicketMigrationArgs',
		schema: TicketMigrationArgsSchema,
		accepted: [{ anonymousUserId: '' }, { anonymousUserId: 'visitor_1' }]
	},
	{
		name: 'PromptLocaleArgs',
		schema: PromptLocaleArgsSchema,
		accepted: [{}, { locale: undefined }, { locale: '' }, { locale: 'de' }]
	},
	{
		name: 'SavePromptArgs',
		schema: SavePromptArgsSchema,
		accepted: [
			{ systemPrompt: '' },
			{ systemPrompt: 'p', locale: undefined, note: undefined },
			{ systemPrompt: 'p', locale: 'de', note: 'n' }
		]
	},
	{
		name: 'PromptActivationArgs',
		schema: PromptActivationArgsSchema,
		accepted: [
			{ id: 'k1', active: true },
			{ id: 'k2', active: false }
		]
	},
	{
		name: 'UploadRegistrationArgs',
		schema: UploadRegistrationArgsSchema,
		accepted: [
			{ storageId: 's1', uploadToken: '', mimeType: '' },
			{
				storageId: 's1',
				uploadToken: 't',
				mimeType: 'image/png',
				filename: undefined,
				locale: undefined,
				accessKey: undefined,
				width: undefined,
				height: undefined
			},
			{
				storageId: 's1',
				uploadToken: 't',
				mimeType: 'image/png',
				filename: 'a.png',
				locale: 'de',
				accessKey: 'support',
				width: 0,
				height: 1.5
			}
		]
	},
	{
		name: 'AttachmentTextArgs',
		schema: AttachmentTextArgsSchema,
		accepted: [
			{ url: '' },
			{ url: 'https://files.test/a.txt', anonymousUserId: undefined, locale: undefined },
			{ url: 'https://files.test/a.txt', anonymousUserId: 'anon_1', locale: 'de' }
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
