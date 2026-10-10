import type { FunctionReference } from 'convex/server';
import { v, type Infer, type ObjectType } from 'convex/values';
import type { QueryCtx } from '../../_generated/server';
import type { JourneyFormat } from './format';

/**
 * The contract between the shared journey core and the sources a fork
 * registers. A source is one module: a bounded internal query that returns
 * typed facts, and a presenter that turns those facts into steps and metrics.
 * The core never imports a source; the registry is passed in.
 */

export const journeyEpisodeValidator = v.union(
	v.literal('new_customer'),
	v.literal('cancellation')
);
export type JourneyEpisode = Infer<typeof journeyEpisodeValidator>;

/** Argument fields of every source read: the frozen request of one email. */
export const journeyRequestFields = {
	episode: journeyEpisodeValidator,
	userId: v.string(),
	signupAt: v.number(),
	paymentAt: v.number(),
	window: v.object({ start: v.number(), end: v.number() })
};
export type JourneyRequest = ObjectType<typeof journeyRequestFields>;

/**
 * How complete a source's read was. `truncated` comes from the backend's
 * `isDone` or a `take(n + 1)` sentinel, never from a page length. `capture`
 * is set by sources that record their own facts: `not_started` when this
 * deployment has never captured the source, otherwise the marker's time.
 */
export const coverageValidator = v.object({
	truncated: v.boolean(),
	capture: v.optional(
		v.union(
			v.object({ kind: v.literal('started'), at: v.number() }),
			v.object({ kind: v.literal('not_started') })
		)
	)
});
export type Coverage = Infer<typeof coverageValidator>;

/** Dot and title colour: plain, the payment, friction, and the cancellation. */
export type JourneyTone = 'neutral' | 'paid' | 'problem' | 'canceled';

export type JourneyStep = {
	/** `<sourceId>:<name>`, or `<milestone>:<name>` for steps a composer adds. */
	key: string;
	at: number;
	title: string;
	lines: string[];
	tone: JourneyTone;
};

/**
 * A summary tile. `count` carries the number behind `value` for summary copy;
 * an absent `count` means unknown, never zero. `unknown` marks a `value` that
 * says why nothing is known, such as "not recorded yet"; a coverage note says
 * the same, so a renderer may show the tile without it.
 */
export type JourneyMetric = {
	key: string;
	label: string;
	value: string;
	count?: { n: number; lowerBound: boolean };
	unknown?: true;
};

export type JourneyPresentation = { steps: JourneyStep[]; metrics: JourneyMetric[] };

/**
 * The largest presentation a source may return. Counts limit array lengths;
 * the rest are UTF-16 code units. A presentation over any bound makes the
 * source unavailable; strings are never cut.
 */
export type PresentationBounds = {
	steps: number;
	linesPerStep: number;
	metrics: number;
	title: number;
	line: number;
	metricLabel: number;
	metricValue: number;
};

export const DEFAULT_BOUNDS: PresentationBounds = {
	steps: 6,
	linesPerStep: 4,
	metrics: 4,
	title: 120,
	line: 240,
	metricLabel: 64,
	metricValue: 64
};

/** The enclosing read envelope of a source, passed as `transactionLimits`. */
export type JourneyReadLimits = { documentsRead: number; bytesRead: number };

/** The slice of a query or mutation context a source read needs. */
export type JourneyReadCtx = Pick<QueryCtx, 'runQuery'>;

/** What one successful read leaves for presentation: coverage and a closure over the facts. */
export type LoadedFacts = {
	coverage: Coverage;
	present(format: JourneyFormat): JourneyPresentation;
};

/** A registered source with its facts type erased. Built by `defineJourneySource`. */
export type JourneySource<Id extends string = string> = {
	readonly id: Id;
	/** Copy key naming the source in coverage notes. */
	readonly label: string;
	readonly limits: JourneyReadLimits;
	readonly bounds: PresentationBounds;
	/** Runs the source's read under its envelope. Throws when the read fails. */
	load(ctx: JourneyReadCtx, request: JourneyRequest): Promise<LoadedFacts>;
	/** The tiles this source fills for the request, known without facts. */
	unavailableMetrics(request: JourneyRequest, format: JourneyFormat): JourneyMetricSlot[];
};

export type JourneyMetricSlot = { key: string; label: string };

/**
 * Declare a journey source. The facts type flows from the read's return
 * validator into `present`, and is erased in the returned source so sources
 * with different facts share one registry array.
 */
export function defineJourneySource<
	const Id extends string,
	Facts extends { coverage: Coverage }
>(config: {
	id: Id;
	label: string;
	read: FunctionReference<'query', 'internal', JourneyRequest, Facts>;
	limits: JourneyReadLimits;
	bounds?: Partial<PresentationBounds>;
	present(facts: Facts, request: JourneyRequest, format: JourneyFormat): JourneyPresentation;
	unavailableMetrics?(request: JourneyRequest, format: JourneyFormat): JourneyMetricSlot[];
}): JourneySource<Id> {
	const { id, label, read, limits, present, unavailableMetrics } = config;
	return {
		id,
		label,
		limits,
		bounds: { ...DEFAULT_BOUNDS, ...config.bounds },
		async load(ctx, request) {
			const facts = await ctx.runQuery(read, request, { transactionLimits: limits });
			return {
				coverage: facts.coverage,
				present: (format) => present(facts, request, format)
			};
		},
		unavailableMetrics: (request, format) => unavailableMetrics?.(request, format) ?? []
	};
}
