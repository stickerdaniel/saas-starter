import { SchemaToValidator } from '@confect/core';
import { validate } from 'convex-helpers/validators';
import { v } from 'convex/values';
import * as Schema from 'effect/Schema';
import { describe, expect, it } from 'vitest';
import {
	AdminReplyArgsSchema,
	InternalNoteArgsSchema,
	ReceiptCleanupArgsSchema,
	RecipientEnqueueArgsSchema,
	ThreadAssignmentArgsSchema,
	ThreadPriorityArgsSchema,
	ThreadStatusArgsSchema
} from './schemas';

const recipient = {
	notificationId: 'notification_1',
	generation: 'generation_1',
	claimToken: 'claim_1',
	email: 'admin@example.com',
	isReopen: false,
	isBareHandoff: true,
	userName: '',
	messages: [],
	threadId: 'thread_1'
};

const cases: ReadonlyArray<{
	name: string;
	schema: Schema.Codec<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>;
	accepted: readonly unknown[];
}> = [
	{
		name: 'ThreadAssignmentArgs',
		schema: ThreadAssignmentArgsSchema,
		accepted: [
			{ threadId: 't1' },
			{ threadId: 't1', adminUserId: undefined },
			{ threadId: '', adminUserId: '' }
		]
	},
	{
		name: 'ThreadStatusArgs',
		schema: ThreadStatusArgsSchema,
		accepted: [
			{ threadId: 't1', status: 'open' },
			{ threadId: 't1', status: 'done' }
		]
	},
	{
		name: 'ThreadPriorityArgs',
		schema: ThreadPriorityArgsSchema,
		accepted: [
			{ threadId: 't1' },
			{ threadId: 't1', priority: undefined },
			{ threadId: 't1', priority: 'low' }
		]
	},
	{
		name: 'AdminReplyArgs',
		schema: AdminReplyArgsSchema,
		accepted: [
			{ threadId: 't1', prompt: '' },
			{ threadId: 't1', prompt: 'hi', fileIds: undefined },
			{ threadId: 't1', prompt: 'hi', fileIds: [] }
		]
	},
	{
		name: 'InternalNoteArgs',
		schema: InternalNoteArgsSchema,
		accepted: [{ userId: 'anon_1', content: '' }]
	},
	{
		name: 'RecipientEnqueueArgs',
		schema: RecipientEnqueueArgsSchema,
		accepted: [recipient, { ...recipient, messages: [{ text: '', timestamp: '' }] }]
	},
	{
		name: 'ReceiptCleanupArgs',
		schema: ReceiptCleanupArgsSchema,
		accepted: [
			{ notificationId: 'notification_1', cursor: null },
			{ notificationId: 'notification_1', cursor: '' }
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
