import type { FunctionReference } from 'convex/server';
import { v, type Infer, type ObjectType } from 'convex/values';
import { t } from '../../../i18n/translations';
import type { QueryCtx } from '../../../_generated/server';
import { createClock, formatCount, type JourneyFormat } from '../format';
import {
	coverageValidator,
	type Coverage,
	type JourneyMetric,
	type JourneyMetricSlot,
	type JourneyRequest,
	type JourneyStep
} from '../source';

/**
 * Shared reading and wording of the template's captured activity sources.
 * Activity splits at the payment into two partitions, each the intersection
 * of the window with one side of the payment:
 * - before: `[window.start, min(paymentAt, window.end))`
 * - after: `[max(paymentAt, window.start), window.end]`
 * so an event exactly at the payment counts once, after it. An empty
 * intersection is never queried.
 */

export type PartitionRange = { start: number; end: number; includeEnd: boolean };

export function partitionRanges(request: JourneyRequest): {
	before: PartitionRange | null;
	after: PartitionRange | null;
} {
	const { window, paymentAt } = request;
	const beforeEnd = Math.min(paymentAt, window.end);
	const afterStart = Math.max(paymentAt, window.start);
	return {
		before:
			window.start < beforeEnd ? { start: window.start, end: beforeEnd, includeEnd: false } : null,
		after:
			afterStart <= window.end ? { start: afterStart, end: window.end, includeEnd: true } : null
	};
}

/** Arguments of a nested partition read. */
export const partitionReadFields = {
	userId: v.string(),
	start: v.number(),
	end: v.number(),
	includeEnd: v.boolean()
};
export type PartitionReadArgs = ObjectType<typeof partitionReadFields>;

/** One partition's counted events, with the first and last it saw. */
export const partitionCountValidator = v.object({
	count: v.number(),
	firstAt: v.union(v.number(), v.null()),
	lastAt: v.union(v.number(), v.null()),
	truncated: v.boolean()
});
export type PartitionCount = Infer<typeof partitionCountValidator>;

/** Facts of a partitioned source; a null partition was not queried. */
export const partitionedFactsValidator = v.object({
	coverage: coverageValidator,
	before: v.union(partitionCountValidator, v.null()),
	after: v.union(partitionCountValidator, v.null())
});
export type PartitionedFacts = Infer<typeof partitionedFactsValidator>;

/** The source's capture marker: when this deployment first recorded it, if ever. */
export async function readCapture(
	ctx: QueryCtx,
	source: string
): Promise<NonNullable<Coverage['capture']>> {
	const marker = await ctx.db
		.query('journeyCaptureStarts')
		.withIndex('by_source', (q) => q.eq('source', source))
		.first();
	return marker ? { kind: 'started', at: marker.startedAt } : { kind: 'not_started' };
}

/**
 * Read a captured source: its marker, then each non-empty partition through
 * `count`, a nested query, because Convex allows one `.paginate` per function.
 * A source never captured reads nothing more.
 */
export async function readPartitioned(
	ctx: QueryCtx,
	source: string,
	request: JourneyRequest,
	count: FunctionReference<'query', 'internal', PartitionReadArgs, PartitionCount>
): Promise<PartitionedFacts> {
	const capture = await readCapture(ctx, source);
	if (capture.kind === 'not_started') {
		return { coverage: { truncated: false, capture }, before: null, after: null };
	}
	const ranges = partitionRanges(request);
	const read = async (range: PartitionRange | null) =>
		range ? await ctx.runQuery(count, { userId: request.userId, ...range }) : null;
	const before = await read(ranges.before);
	const after = await read(ranges.after);
	return {
		coverage: { truncated: Boolean(before?.truncated || after?.truncated), capture },
		before,
		after
	};
}

/** Count events from one page of rows, keeping the first and last counted time. */
export function countPage<Row extends { _creationTime: number }>(
	page: readonly Row[],
	isDone: boolean,
	counts: (row: Row) => boolean = () => true
): PartitionCount {
	const counted = page.filter(counts);
	return {
		count: counted.length,
		firstAt: counted[0]?._creationTime ?? null,
		lastAt: counted[counted.length - 1]?._creationTime ?? null,
		truncated: !isDone
	};
}

type PartitionMetric = 'before_paying' | 'window';

/** The copy keys of one partitioned source, under `email.customer_journey.source.<id>`. */
export type PartitionedCopy = {
	step: { one: string; many: string };
	range: { complete: string; observed: string };
	metric: Record<PartitionMetric, string>;
};

/**
 * The tile a partitioned source fills: "before paying" when the window opens
 * at signup, so its first partition covers everything before the payment;
 * otherwise a count over the whole window.
 */
function metricName(request: JourneyRequest): PartitionMetric {
	return request.window.start <= request.signupAt ? 'before_paying' : 'window';
}

function metricSlot(
	id: string,
	copy: PartitionedCopy,
	request: JourneyRequest,
	format: JourneyFormat
): JourneyMetricSlot {
	const name = metricName(request);
	return { key: `${id}:${name}`, label: t(format.locale, copy.metric[name]) };
}

/** `unavailableMetrics` of a partitioned source. */
export function partitionedSlots(id: string, copy: PartitionedCopy) {
	return (request: JourneyRequest, format: JourneyFormat) => [
		metricSlot(id, copy, request, format)
	];
}

/**
 * Steps and the tile of a partitioned source. One step per partition with
 * events, at its first event; a cut-short partition says "at least" and calls
 * its last time observed.
 */
export function presentPartitioned(
	id: string,
	copy: PartitionedCopy,
	facts: PartitionedFacts,
	request: JourneyRequest,
	format: JourneyFormat
): { steps: JourneyStep[]; metrics: JourneyMetric[] } {
	const { locale } = format;
	const clock = createClock(format);

	const step = (name: 'before' | 'after', partition: PartitionCount | null): JourneyStep[] => {
		if (!partition || partition.firstAt === null || partition.lastAt === null) return [];
		const { count, truncated, firstAt, lastAt } = partition;
		const single = count === 1 && !truncated;
		return [
			{
				key: `${id}:${name}`,
				at: firstAt,
				title: single
					? t(locale, copy.step.one)
					: t(locale, copy.step.many, { count: formatCount(count, truncated, locale) }),
				lines: single
					? []
					: [
							t(locale, truncated ? copy.range.observed : copy.range.complete, {
								first: clock.time(firstAt, firstAt),
								last: clock.time(lastAt, firstAt)
							})
						],
				tone: 'neutral'
			}
		];
	};

	const slot = metricSlot(id, copy, request, format);
	// Never captured: no count at all, so nothing reads as zero.
	if (facts.coverage.capture?.kind === 'not_started') {
		return {
			steps: [],
			metrics: [
				{
					...slot,
					value: t(locale, 'email.customer_journey.core.value.not_recorded'),
					unknown: true
				}
			]
		};
	}
	const counted =
		metricName(request) === 'before_paying' ? [facts.before] : [facts.before, facts.after];
	const n = counted.reduce((sum, partition) => sum + (partition?.count ?? 0), 0);
	const lowerBound = counted.some((partition) => partition?.truncated === true);

	return {
		steps: [...step('before', facts.before), ...step('after', facts.after)],
		metrics: [{ ...slot, value: formatCount(n, lowerBound, locale), count: { n, lowerBound } }]
	};
}
