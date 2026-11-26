import { SchemaToValidator } from '@confect/core';
import { validate } from 'convex-helpers/validators';
import { v } from 'convex/values';
import * as Schema from 'effect/Schema';
import { describe, expect, it } from 'vitest';
import {
	AIResponseArgsSchema,
	AssistantMessageArgsSchema,
	AttachmentTextArgsSchema,
	FileMetadataBatchArgsSchema,
	HandoffArgsSchema,
	NotificationEmailArgsSchema,
	ProfileSyncArgsSchema,
	PromptActivationArgsSchema,
	PromptLocaleArgsSchema,
	SavedAssistantMessageSchema,
	SavePromptArgsSchema,
	SendMessageArgsSchema,
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
	TurnArgsSchema,
	TurnWatchArgsSchema,
	UnansweredTurnSchema,
	VisitorMessageListArgsSchema,
	WarmThreadArgsSchema
} from './schemas';
import { UploadRegistrationArgsSchema } from '../files/schemas';

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
	},
	{
		name: 'SendMessageArgs',
		schema: SendMessageArgsSchema,
		accepted: [
			{ threadId: '', prompt: '' },
			{
				threadId: 't1',
				prompt: 'p',
				anonymousUserId: undefined,
				fileIds: undefined,
				pageUrl: undefined,
				appVersion: undefined
			},
			{
				threadId: 't1',
				prompt: 'p',
				anonymousUserId: 'anon_1',
				fileIds: [],
				pageUrl: '/de/app',
				appVersion: 'abc'
			},
			{ threadId: 't1', prompt: 'p', fileIds: ['f1', 'f2'] }
		]
	},
	{
		name: 'AIResponseArgs',
		schema: AIResponseArgsSchema,
		accepted: [
			{ threadId: 't1', promptMessageId: 'm1' },
			{ threadId: 't1', promptMessageId: 'm1', userId: undefined },
			{ threadId: 't1', promptMessageId: 'm1', userId: 'anon_1' }
		]
	},
	{
		name: 'TurnArgs',
		schema: TurnArgsSchema,
		accepted: [{ threadId: '', promptMessageId: '' }]
	},
	{
		name: 'TurnWatchArgs',
		schema: TurnWatchArgsSchema,
		accepted: [
			{ threadId: 't1', promptMessageId: 'm1', jobId: 'k1', checksLeft: 0 },
			{ threadId: 't1', promptMessageId: 'm1', jobId: 'k1', checksLeft: 4.5 }
		]
	},
	{
		name: 'VisitorMessageListArgs',
		schema: VisitorMessageListArgsSchema,
		accepted: [
			{ threadId: 't1', paginationOpts: { numItems: 20, cursor: null } },
			{
				threadId: 't1',
				anonymousUserId: undefined,
				paginationOpts: { numItems: 20, cursor: 'c1' },
				streamArgs: undefined
			},
			{
				threadId: 't1',
				anonymousUserId: 'anon_1',
				paginationOpts: { numItems: 20, cursor: null },
				streamArgs: { kind: 'list' }
			},
			{
				threadId: 't1',
				paginationOpts: { numItems: 20, cursor: null },
				streamArgs: { kind: 'list', startOrder: 3 }
			},
			{
				threadId: 't1',
				paginationOpts: { numItems: 20, cursor: null },
				streamArgs: { kind: 'deltas', cursors: [] }
			},
			{
				threadId: 't1',
				paginationOpts: { numItems: 20, cursor: null },
				streamArgs: { kind: 'deltas', cursors: [{ streamId: 's1', cursor: 0 }] }
			}
		]
	},
	{
		name: 'AssistantMessageArgs',
		schema: AssistantMessageArgsSchema,
		accepted: [{ threadId: 't1', text: '' }]
	},
	{
		name: 'FileMetadataBatchArgs',
		schema: FileMetadataBatchArgsSchema,
		accepted: [{ urls: [] }, { urls: ['https://files.test/a.png', ''] }]
	}
];

describe.each(cases)('$name', ({ schema, accepted }) => {
	const native = v.object(SchemaToValidator.compileArgsSchema(schema));

	it.each(accepted)('decodes what its compiled validator accepts: %j', (value) => {
		expect(validate(native, value)).toBe(true);
		expect(() => Schema.decodeUnknownSync(schema)(value)).not.toThrow();
	});
});

describe('SavedAssistantMessage', () => {
	const saved = {
		messageId: 'm1',
		message: {
			_id: 'm1',
			_creationTime: 1,
			threadId: 't1',
			order: 1,
			stepOrder: 0,
			status: 'success',
			tool: false,
			message: { role: 'assistant', content: 'ok' }
		}
	};

	it.each([null, saved])('decodes a saved message or null: %j', (value) => {
		expect(Schema.decodeUnknownSync(SavedAssistantMessageSchema)(value)).toEqual(value);
	});

	it.each([42, { messageId: 'm1' }, { ...saved, message: { ...saved.message, status: 'done' } }])(
		'refuses a value that is not a saved message: %j',
		(value) => {
			expect(() => Schema.decodeUnknownSync(SavedAssistantMessageSchema)(value)).toThrow();
		}
	);
});
