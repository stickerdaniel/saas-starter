import { SchemaToValidator } from '@confect/core';
import { vStreamArgs } from '@convex-dev/agent/validators';
import { vEmailEvent, vEmailId } from '@convex-dev/resend';
import { validate } from 'convex-helpers/validators';
import { paginationOptsValidator } from 'convex/server';
import { v, type GenericValidator } from 'convex/values';
import * as Schema from 'effect/Schema';
import { describe, expect, it } from 'vitest';
import { tables } from '../../convex-components/betterAuth/schema';
import { StreamArgs } from './agent';
import { BetterAuthUserSchema } from './betterAuth';
import { PaginationOpts } from './pagination';
import { EmailEvent, EmailId } from './resend';

const sent = {
	type: 'email.sent',
	created_at: '2026-11-22T10:00:00.000Z',
	data: {
		created_at: '2026-11-22T10:00:00.000Z',
		email_id: 'email_1',
		from: 'Acme <hello@example.com>',
		to: ['ada@example.com'],
		subject: 'Welcome'
	}
};

const cases: ReadonlyArray<{
	name: string;
	schema: Schema.Codec<unknown, unknown>;
	native: GenericValidator;
	accepted: readonly unknown[];
	rejected: readonly unknown[];
}> = [
	{
		name: 'EmailId',
		schema: EmailId,
		native: vEmailId,
		accepted: ['4ef9a417-02e9-4d39-ad75-9611e0fcc33c', ''],
		rejected: [42, null, undefined]
	},
	{
		name: 'EmailEvent',
		schema: EmailEvent,
		native: vEmailEvent,
		accepted: [
			sent,
			{ ...sent, data: { ...sent.data, cc: undefined, tags: undefined } },
			{
				...sent,
				type: 'email.bounced',
				data: {
					...sent.data,
					cc: 'bob@example.com',
					headers: [{ name: 'X-Entity', value: '1' }],
					tags: { category: 'welcome' },
					bounce: { message: 'Mailbox full', subType: 'MailboxFull', type: 'Transient' }
				}
			},
			{
				...sent,
				type: 'email.clicked',
				data: {
					...sent.data,
					tags: [{ name: 'category', value: 'welcome' }],
					click: {
						ipAddress: '203.0.113.7',
						link: 'https://example.com',
						timestamp: '2026-11-22T10:01:00.000Z',
						userAgent: 'Mozilla/5.0'
					}
				}
			}
		],
		rejected: [
			{ ...sent, type: 'email.unknown' },
			{ ...sent, type: 'email.bounced' },
			{ ...sent, data: { ...sent.data, subject: undefined } },
			{ ...sent, data: { ...sent.data, to: [1] } }
		]
	},
	{
		name: 'StreamArgs',
		schema: StreamArgs,
		native: vStreamArgs,
		accepted: [
			undefined,
			{ kind: 'list' },
			{ kind: 'list', startOrder: undefined },
			{ kind: 'list', startOrder: 3 },
			{ kind: 'deltas', cursors: [] },
			{ kind: 'deltas', cursors: [{ streamId: 's1', cursor: 0 }] }
		],
		rejected: [
			{ kind: 'deltas' },
			{ kind: 'list', startOrder: '3' },
			{ kind: 'deltas', cursors: [{ streamId: 's1' }] },
			{ kind: 'other' }
		]
	},
	{
		name: 'BetterAuthUser',
		schema: BetterAuthUserSchema,
		native: tables.user.validator,
		accepted: [
			{
				name: 'Ada',
				email: 'ada@example.com',
				emailVerified: true,
				createdAt: 1,
				updatedAt: 2
			},
			{
				name: 'Ada',
				email: 'ada@example.com',
				emailVerified: false,
				image: null,
				createdAt: 1,
				updatedAt: 2,
				userId: null,
				role: 'admin',
				banned: true,
				banReason: 'spam',
				banExpires: 3,
				locale: 'de'
			}
		],
		rejected: [
			{ name: 'Ada', email: 'ada@example.com', createdAt: 1, updatedAt: 2 },
			{
				name: 'Ada',
				email: 'ada@example.com',
				emailVerified: true,
				createdAt: 1,
				updatedAt: 2,
				banned: 'yes'
			}
		]
	},
	{
		name: 'PaginationOpts',
		schema: PaginationOpts,
		native: paginationOptsValidator,
		accepted: [
			{ numItems: 10, cursor: null },
			{ numItems: Number.POSITIVE_INFINITY, cursor: null },
			{ numItems: 10, cursor: null, endCursor: undefined, id: undefined },
			{
				numItems: 10,
				cursor: 'c1',
				endCursor: null,
				id: 2,
				maximumRowsRead: 100,
				maximumBytesRead: 1_000
			}
		],
		rejected: [{ numItems: 10 }, { numItems: '10', cursor: null }, { cursor: null }]
	}
];

const optional = (validator: GenericValidator) =>
	validator.isOptional === 'optional' ? validator : v.optional(validator);

describe.each(cases)('$name', ({ schema, native, accepted, rejected }) => {
	it('compiles to the native validator', () => {
		const compiled = SchemaToValidator.compileArgsSchema(
			Schema.Struct({ value: Schema.optionalKey(schema) })
		);
		expect(compiled).toEqual({ value: optional(native) });
	});

	it.each(accepted)('round-trips an accepted value: %j', (value) => {
		expect(validate(native, value)).toBe(true);
		const decoded = Schema.decodeUnknownSync(schema)(value);
		expect(Schema.encodeSync(schema)(decoded)).toEqual(value);
	});

	it.each(rejected)('rejects a value the native validator rejects: %j', (value) => {
		expect(validate(native, value)).toBe(false);
		expect(() => Schema.decodeUnknownSync(schema)(value)).toThrow();
	});
});
