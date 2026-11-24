import { SchemaToValidator } from '@confect/core';
import { validate } from 'convex-helpers/validators';
import { v } from 'convex/values';
import * as Schema from 'effect/Schema';
import { describe, expect, it } from 'vitest';
import {
	AttachmentTextArgsSchema,
	HandoffArgsSchema,
	NotificationEmailArgsSchema,
	ProfileSyncArgsSchema,
	PromptActivationArgsSchema,
	PromptLocaleArgsSchema,
	SavePromptArgsSchema,
	SupportOwnerArgsSchema,
	SweepArgsSchema,
	ThreadAccessArgsSchema,
	ThreadCreateArgsSchema,
	ThreadHandoffArgsSchema,
	ThreadIdArgsSchema,
	ThreadListArgsSchema,
	ThreadMetadataArgsSchema,
	ThreadReadArgsSchema,
	TicketMigrationArgsSchema,
	UnansweredTurnSchema,
	UploadRegistrationArgsSchema,
	WarmThreadArgsSchema
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
	},
	{
		name: 'ThreadCreateArgs',
		schema: ThreadCreateArgsSchema,
		accepted: [
			{},
			{ anonymousUserId: undefined, title: undefined, pageUrl: undefined },
			{ anonymousUserId: 'anon_1', title: '', pageUrl: '/de/app' }
		]
	},
	{
		name: 'WarmThreadArgs',
		schema: WarmThreadArgsSchema,
		accepted: [{}, { anonymousUserId: undefined, pageUrl: undefined }, { pageUrl: '' }]
	},
	{
		name: 'ThreadListArgs',
		schema: ThreadListArgsSchema,
		accepted: [
			{},
			{ paginationOpts: undefined },
			{ anonymousUserId: 'anon_1', paginationOpts: { numItems: 20, cursor: null } },
			{ paginationOpts: { numItems: 5, cursor: 'c1', endCursor: null, maximumRowsRead: 1 } }
		]
	},
	{
		name: 'ThreadAccessArgs',
		schema: ThreadAccessArgsSchema,
		accepted: [{ threadId: '' }, { threadId: 't1', anonymousUserId: undefined }]
	},
	{
		name: 'ThreadHandoffArgs',
		schema: ThreadHandoffArgsSchema,
		accepted: [
			{ threadId: 't1' },
			{ threadId: 't1', anonymousUserId: undefined, pageUrl: undefined, appVersion: undefined },
			{ threadId: 't1', anonymousUserId: 'anon_1', pageUrl: 'javascript:1', appVersion: 'abc' }
		]
	},
	{
		name: 'NotificationEmailArgs',
		schema: NotificationEmailArgsSchema,
		accepted: [
			{ threadId: 't1', email: '' },
			{ threadId: 't1', email: 'not-an-email', anonymousUserId: undefined }
		]
	},
	{
		name: 'ThreadMetadataArgs',
		schema: ThreadMetadataArgsSchema,
		accepted: [{ threadId: 't1' }, { threadId: 't1', title: undefined, summary: '' }]
	},
	{
		name: 'ThreadIdArgs',
		schema: ThreadIdArgsSchema,
		accepted: [{ threadId: '' }]
	},
	{
		name: 'ProfileSyncArgs',
		schema: ProfileSyncArgsSchema,
		accepted: [
			{ userId: 'u1' },
			{
				userId: 'u1',
				userName: undefined,
				userEmail: undefined,
				cursor: undefined,
				endCursor: undefined
			},
			{ userId: 'u1', userName: '', userEmail: 'a@b.co', cursor: 'c1', endCursor: 'c2' }
		]
	},
	{
		name: 'SweepArgs',
		schema: SweepArgsSchema,
		accepted: [{ supportThreadId: 'k1' }]
	},
	{
		name: 'HandoffArgs',
		schema: HandoffArgsSchema,
		accepted: [
			{ threadId: '' },
			{ threadId: 't1', acknowledge: undefined },
			{ threadId: 't1', acknowledge: false }
		]
	},
	{
		name: 'UnansweredTurn',
		schema: UnansweredTurnSchema,
		accepted: [
			{ threadId: 't1', promptMessageId: 'm1', reason: 'job_missing' },
			{
				threadId: 't1',
				promptMessageId: 'm1',
				reason: 'no_reply',
				attempts: undefined,
				visibleText: undefined,
				errorName: undefined,
				status: undefined
			},
			{
				threadId: 't1',
				promptMessageId: 'm1',
				reason: 'retry_rate_limited',
				attempts: 2,
				visibleText: false,
				errorName: 'other',
				status: 502.5
			},
			{ threadId: 't1', promptMessageId: 'm1', reason: 'partial_reply', status: Number.NaN }
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
