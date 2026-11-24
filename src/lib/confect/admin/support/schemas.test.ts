import { SchemaToValidator } from '@confect/core';
import { validate } from 'convex-helpers/validators';
import { v } from 'convex/values';
import * as Schema from 'effect/Schema';
import { describe, expect, it } from 'vitest';
import {
	AdminReplyArgsSchema,
	InternalNoteArgsSchema,
	LegacyClaimsArgsSchema,
	MessageContentsArgsSchema,
	NotificationClaimArgsSchema,
	NotificationOwnershipArgsSchema,
	NotificationRecoveryArgsSchema,
	NotificationRescheduleArgsSchema,
	NotificationScheduleArgsSchema,
	NotificationSendArgsSchema,
	ReceiptCleanupArgsSchema,
	RecentUserMessagesArgsSchema,
	TargetEmailsArgsSchema,
	RecipientEnqueueArgsSchema,
	ThreadArgsSchema,
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
	},
	{
		name: 'ThreadArgs',
		schema: ThreadArgsSchema,
		accepted: [{ threadId: '' }]
	},
	{
		name: 'NotificationScheduleArgs',
		schema: NotificationScheduleArgsSchema,
		accepted: [
			{ threadId: 't1', messageIds: [], isReopen: false, notificationType: 'newTickets' },
			{ threadId: 't1', messageIds: ['m1'], isReopen: true, notificationType: 'userReplies' }
		]
	},
	{
		name: 'NotificationSendArgs',
		schema: NotificationSendArgsSchema,
		accepted: [{ notificationId: 'notification_1' }]
	},
	{
		name: 'NotificationClaimArgs',
		schema: NotificationClaimArgsSchema,
		accepted: [
			{ notificationId: 'notification_1' },
			{ notificationId: 'notification_1', issueToken: undefined, receiptProtocol: undefined },
			{ notificationId: 'notification_1', issueToken: false, receiptProtocol: 1 }
		]
	},
	{
		name: 'NotificationOwnershipArgs',
		schema: NotificationOwnershipArgsSchema,
		accepted: [
			{ notificationId: 'notification_1' },
			{ notificationId: 'notification_1', claimToken: undefined },
			{ notificationId: 'notification_1', claimToken: '' }
		]
	},
	{
		name: 'NotificationRescheduleArgs',
		schema: NotificationRescheduleArgsSchema,
		accepted: [
			{ notificationId: 'notification_1', delayMs: undefined },
			{ notificationId: 'notification_1', claimToken: 'c1', delayMs: Number.POSITIVE_INFINITY },
			{ notificationId: 'notification_1', delayMs: Number.NaN },
			{ notificationId: 'notification_1', delayMs: -1 }
		]
	},
	{
		name: 'NotificationRecoveryArgs',
		schema: NotificationRecoveryArgsSchema,
		accepted: [
			{ notificationId: 'notification_1', generation: 'g1', claimToken: 'c1', deadline: 0 },
			{
				notificationId: 'notification_1',
				generation: 'g1',
				claimToken: 'c1',
				deadline: Number.NEGATIVE_INFINITY
			},
			{ notificationId: 'notification_1', generation: 'g1', claimToken: 'c1', deadline: Number.NaN }
		]
	},
	{
		name: 'LegacyClaimsArgs',
		schema: LegacyClaimsArgsSchema,
		accepted: [
			{ paginationOpts: { numItems: 10, cursor: null } },
			{ paginationOpts: { numItems: Number.POSITIVE_INFINITY, cursor: 'c1' } },
			{ paginationOpts: { numItems: Number.NaN, cursor: null, endCursor: undefined } }
		]
	},
	{
		name: 'TargetEmailsArgs',
		schema: TargetEmailsArgsSchema,
		accepted: [
			{ notificationType: 'newTickets' },
			{ notificationType: 'userReplies', assignedTo: undefined },
			{ notificationType: 'userReplies', assignedTo: 'admin_1' }
		]
	},
	{
		name: 'MessageContentsArgs',
		schema: MessageContentsArgsSchema,
		accepted: [{ messageIds: [] }, { messageIds: ['m1', 'm2'] }]
	},
	{
		name: 'RecentUserMessagesArgs',
		schema: RecentUserMessagesArgsSchema,
		accepted: [
			{ threadId: 't1' },
			{ threadId: 't1', limit: undefined },
			{ threadId: 't1', limit: Number.POSITIVE_INFINITY },
			{ threadId: 't1', limit: Number.NaN }
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
