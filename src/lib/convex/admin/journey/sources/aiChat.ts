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
 * AI chat messages a user sent, counted from the receipts `sendMessage`
 * writes (one per message), before and after the payment.
 */

const KiB = 1024;
const MiB = 1024 * KiB;

const COPY = {
	step: {
		one: 'email.customer_journey.source.aiChat.step.one',
		many: 'email.customer_journey.source.aiChat.step.many'
	},
	range: {
		complete: 'email.customer_journey.source.aiChat.range.complete',
		observed: 'email.customer_journey.source.aiChat.range.observed'
	},
	metric: {
		before_paying: 'email.customer_journey.source.aiChat.metric.before_paying',
		window: 'email.customer_journey.source.aiChat.metric.window'
	}
} as const satisfies PartitionedCopy;

export const read = internalQuery({
	args: journeyRequestFields,
	returns: partitionedFactsValidator,
	handler: async (ctx, request): Promise<PartitionedFacts> =>
		await readPartitioned(
			ctx,
			'aiChat',
			request,
			async ({ start, end }) =>
				await ctx.db
					.query('aiChatMessageReceipts')
					.withIndex('by_user', (q) =>
						q.eq('userId', request.userId).gte('_creationTime', start).lte('_creationTime', end)
					)
					.paginate({
						cursor: null,
						numItems: 4000,
						maximumRowsRead: 4000,
						maximumBytesRead: MiB
					})
		)
});

export const aiChatSource: JourneySource<'aiChat'> = defineJourneySource({
	id: 'aiChat',
	label: 'email.customer_journey.source.aiChat.label',
	read: internal.admin.journey.sources.aiChat.read,
	// The marker plus one page of at most 4,000 rows and 1 MiB, what the two
	// partitions once read apart.
	limits: { documentsRead: 4050, bytesRead: 1.5 * MiB },
	present: (facts, request, format) => presentPartitioned('aiChat', COPY, facts, request, format),
	unavailableMetrics: partitionedSlots('aiChat', COPY)
});
