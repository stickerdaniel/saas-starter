import { v, type Infer } from 'convex/values';
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
 * so an event exactly at the payment counts once, after it. Both come from
 * one page over the window, and an empty intersection counts nothing.
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

/** One partition's counted events, with the first and last it saw. */
const partitionCountValidator = v.object({
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

/** One page of a source's rows inside the window, oldest first. */
export type WindowPage<Row> = { page: readonly Row[]; isDone: boolean };

/**
 * Read a captured source: its marker, then one page over the whole window
 * through `scan`, split at the payment. A query and every query it calls
 * share one `.paginate`, so the partitions cannot each page in a query of
 * their own. A source never captured reads nothing more.
 */
export async function readPartitioned<Row extends { _creationTime: number }>(
	ctx: QueryCtx,
	source: string,
	request: JourneyRequest,
	scan: (window: JourneyRequest['window']) => Promise<WindowPage<Row>>,
	counts: (row: Row) => boolean = () => true
): Promise<PartitionedFacts> {
	const capture = await readCapture(ctx, source);
	if (capture.kind === 'not_started') {
		return { coverage: { truncated: false, capture }, before: null, after: null };
	}
	const ranges = partitionRanges(request);
	if (!ranges.before && !ranges.after) {
		return { coverage: { truncated: false, capture }, before: null, after: null };
	}
	const { page, isDone } = await scan(request.window);
	// Oldest first, so a cut-short page has read all of a partition that ends
	// before its last row.
	const lastRead = page[page.length - 1]?._creationTime ?? Number.NEGATIVE_INFINITY;
	const partition = (range: PartitionRange | null): PartitionCount | null => {
		if (!range) return null;
		const inRange = (at: number) =>
			at >= range.start && (range.includeEnd ? at <= range.end : at < range.end);
		const complete = isDone || (range.includeEnd ? lastRead > range.end : lastRead >= range.end);
		return countPage(
			page.filter((row) => inRange(row._creationTime) && counts(row)),
			complete
		);
	};
	const before = partition(ranges.before);
	const after = partition(ranges.after);
	return {
		coverage: { truncated: Boolean(before?.truncated || after?.truncated), capture },
		before,
		after
	};
}

/** Count the events of one partition, keeping the first and last time. */
function countPage(
	counted: ReadonlyArray<{ _creationTime: number }>,
	complete: boolean
): PartitionCount {
	return {
		count: counted.length,
		firstAt: counted[0]?._creationTime ?? null,
		lastAt: counted[counted.length - 1]?._creationTime ?? null,
		truncated: !complete
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
 * The tile a partitioned source fills: "before paying" for a new customer
 * whose window opens at signup, so its first partition covers everything
 * before the payment; otherwise a count over the whole window. A
 * cancellation always counts its window, which is what its email describes,
 * even when that window happens to open at signup.
 */
function metricName(request: JourneyRequest): PartitionMetric {
	return request.episode === 'new_customer' && request.window.start <= request.signupAt
		? 'before_paying'
		: 'window';
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
