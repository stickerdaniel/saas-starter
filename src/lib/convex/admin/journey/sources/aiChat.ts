import { internal } from '../../../_generated/api';
import { internalQuery } from '../../../_generated/server';
import { defineJourneySource, journeyRequestFields, type JourneySource } from '../source';
import {
	countPage,
	partitionCountValidator,
	partitionedFactsValidator,
	partitionedSlots,
	partitionReadFields,
	presentPartitioned,
	readPartitioned,
	type PartitionCount,
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

/** One partition of receipts. Its own function, because each may paginate once. */
export const countPartition = internalQuery({
	args: partitionReadFields,
	returns: partitionCountValidator,
	handler: async (ctx, { userId, start, end, includeEnd }): Promise<PartitionCount> => {
		const { page, isDone } = await ctx.db
			.query('aiChatMessageReceipts')
			.withIndex('by_user', (q) => {
				const from = q.eq('userId', userId).gte('_creationTime', start);
				return includeEnd ? from.lte('_creationTime', end) : from.lt('_creationTime', end);
			})
			.paginate({
				cursor: null,
				numItems: 2000,
				maximumRowsRead: 2000,
				maximumBytesRead: 512 * KiB
			});
		return countPage(page, isDone);
	}
});

export const read = internalQuery({
	args: journeyRequestFields,
	returns: partitionedFactsValidator,
	handler: async (ctx, request): Promise<PartitionedFacts> =>
		await readPartitioned(
			ctx,
			'aiChat',
			request,
			internal.admin.journey.sources.aiChat.countPartition
		)
});

export const aiChatSource: JourneySource<'aiChat'> = defineJourneySource({
	id: 'aiChat',
	label: 'email.customer_journey.source.aiChat.label',
	read: internal.admin.journey.sources.aiChat.read,
	// The marker plus two partitions of at most 2,000 rows and 512 KiB each.
	limits: { documentsRead: 4050, bytesRead: 1.5 * MiB },
	present: (facts, request, format) => presentPartitioned('aiChat', COPY, facts, request, format),
	unavailableMetrics: partitionedSlots('aiChat', COPY)
});
