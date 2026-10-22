import { internal } from '../../../_generated/api';
import { internalQuery } from '../../../_generated/server';
import { defineJourneySource, journeyRequestFields, type JourneySource } from '../source';
import {
	partitionedFactsValidator,
	partitionedSlots,
	presentPartitioned,
	readPartitioned,
	type PartitionedCopy,
	type PartitionedFacts
} from './partitions';

/**
 * Community messages a user sent and kept: only messages the quota backstop
 * settled count. A message still pending settlement is read but not counted,
 * and a denied one is already deleted.
 */

const MiB = 1024 * 1024;

const COPY = {
	step: {
		one: 'email.customer_journey.source.community.step.one',
		many: 'email.customer_journey.source.community.step.many'
	},
	range: {
		complete: 'email.customer_journey.source.community.range.complete',
		observed: 'email.customer_journey.source.community.range.observed'
	},
	metric: {
		before_paying: 'email.customer_journey.source.community.metric.before_paying',
		window: 'email.customer_journey.source.community.metric.window'
	}
} as const satisfies PartitionedCopy;

export const read = internalQuery({
	args: journeyRequestFields,
	returns: partitionedFactsValidator,
	handler: async (ctx, request): Promise<PartitionedFacts> =>
		await readPartitioned(
			ctx,
			'community',
			request,
			async ({ start, end }) =>
				// Message bodies are up to 2,000 characters, so the byte limit usually
				// ends a long page before the row limit; the count then says "at least".
				await ctx.db
					.query('messages')
					.withIndex('by_user', (q) =>
						q.eq('userId', request.userId).gte('_creationTime', start).lte('_creationTime', end)
					)
					.paginate({
						cursor: null,
						numItems: 4000,
						maximumRowsRead: 4000,
						maximumBytesRead: 4 * MiB
					}),
			(message) => message.quotaSettledAt !== undefined
		)
});

export const communitySource: JourneySource<'community'> = defineJourneySource({
	id: 'community',
	label: 'email.customer_journey.source.community.label',
	read: internal.admin.journey.sources.community.read,
	// The marker plus one page of at most 4,000 rows and 4 MiB, what the two
	// partitions once read apart.
	limits: { documentsRead: 4050, bytesRead: 4.5 * MiB },
	present: (facts, request, format) =>
		presentPartitioned('community', COPY, facts, request, format),
	unavailableMetrics: partitionedSlots('community', COPY)
});
