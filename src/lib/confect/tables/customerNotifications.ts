import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';
import { FrozenBillingSchema } from '../admin/customerNotifications/billing';
import { JourneyEpisodeSchema, JourneyRequestSchema } from '../admin/journey/schemas';

export default Table.make(() =>
	Schema.Struct({
		userId: Schema.String,
		kind: JourneyEpisodeSchema,
		episodeKey: Schema.String,
		status: Schema.Literals(['scheduled', 'enqueued', 'skipped', 'failed']),
		skippedReason: Schema.optional(
			Schema.Literals([
				'owner_deleted',
				'test_customer',
				'email_unavailable',
				'no_recipients',
				'audience_incomplete'
			])
		),
		failedReason: Schema.optional(Schema.Literal('audience_unavailable')),
		billing: FrozenBillingSchema,
		request: JourneyRequestSchema,
		observedAt: Schema.Number,
		sendAt: Schema.Number,
		scheduledFnId: Schema.optional(Id('_scheduled_functions')),
		emailIds: Schema.optional(Schema.Array(Schema.String)),
		enqueuedCount: Schema.optional(Schema.Number),
		failedCount: Schema.optional(Schema.Number),
		audienceTruncated: Schema.optional(Schema.Boolean),
		completedAt: Schema.optional(Schema.Number)
	})
)
	.index('by_kind_and_episode', ['kind', 'episodeKey'])
	.index('by_user', ['userId']);
