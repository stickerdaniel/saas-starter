import { t } from '../../i18n/translations';
import { createClock, type JourneyFormat } from './format';
import type {
	Coverage,
	JourneyMetric,
	JourneyPresentation,
	JourneyReadCtx,
	JourneyRequest,
	JourneySource,
	JourneyStep,
	LoadedFacts,
	PresentationBounds
} from './source';

/**
 * Runs a registry of journey sources for one email and turns their facts into
 * steps, tiles and coverage notes. One failing source never takes down the
 * others: its read or its presenter makes only that source unavailable, and
 * its tile slots stay in place with an "unavailable" value.
 *
 * `collectJourney` runs once per email; everything after it runs per
 * recipient, because presentation depends on the recipient's locale and zone.
 * The loaded facts are closures and stay inside the calling function.
 */

type SourceIdentity<Id extends string> = Pick<JourneySource<Id>, 'id' | 'label'> & {
	source: JourneySource<Id>;
};

export type CollectedSource<Id extends string = string> = SourceIdentity<Id> &
	({ status: 'loaded'; facts: LoadedFacts } | { status: 'unavailable' });

export type CollectedJourney<Id extends string = string> = {
	request: JourneyRequest;
	sources: Array<CollectedSource<Id>>;
};

/**
 * Read every source in registry order, each under its own envelope and in its
 * own `try`. A failed read is logged with a fixed code and nothing from the
 * error, which may carry stored data.
 */
export async function collectJourney<const Sources extends readonly JourneySource[]>(
	ctx: JourneyReadCtx,
	sources: Sources,
	request: JourneyRequest
): Promise<CollectedJourney<Sources[number]['id']>> {
	const collected: Array<CollectedSource<Sources[number]['id']>> = [];
	for (const source of sources) {
		const identity = { id: source.id, label: source.label, source };
		try {
			collected.push({ ...identity, status: 'loaded', facts: await source.load(ctx, request) });
		} catch {
			console.warn({ code: 'journey_source_unavailable', source: source.id });
			collected.push({ ...identity, status: 'unavailable' });
		}
	}
	return { request, sources: collected };
}

export type PresentedSource<Id extends string = string> = {
	id: Id;
	label: string;
	steps: JourneyStep[];
	metrics: JourneyMetric[];
} & ({ status: 'presented'; coverage: Coverage } | { status: 'unavailable' });

export type PresentedJourney<Id extends string = string> = {
	request: JourneyRequest;
	sources: Array<PresentedSource<Id>>;
};

const ownedBy = (id: string, key: string) => key.startsWith(`${id}:`);

/** Whether tiles stay inside the source's bounds and own their keys. */
function metricsWithinBounds(
	id: string,
	metrics: readonly JourneyMetric[],
	bounds: PresentationBounds
): boolean {
	return (
		metrics.length <= bounds.metrics &&
		metrics.every(
			(metric) =>
				ownedBy(id, metric.key) &&
				metric.label.length <= bounds.metricLabel &&
				metric.value.length <= bounds.metricValue
		)
	);
}

/** Whether a presentation stays inside the source's bounds and owns its keys. */
function withinBounds(
	id: string,
	{ steps, metrics }: JourneyPresentation,
	bounds: PresentationBounds
): boolean {
	return (
		steps.length <= bounds.steps &&
		steps.every(
			(step) =>
				ownedBy(id, step.key) &&
				Number.isFinite(step.at) &&
				step.title.length <= bounds.title &&
				step.lines.length <= bounds.linesPerStep &&
				step.lines.every((line) => line.length <= bounds.line)
		) &&
		metricsWithinBounds(id, metrics, bounds)
	);
}

/**
 * The source's own tile slots, each showing "unavailable" and carrying no
 * count, under the same bounds as its presented tiles. Null when the slots
 * throw or break those bounds.
 */
function unavailableTiles(
	source: JourneySource,
	request: JourneyRequest,
	format: JourneyFormat
): JourneyMetric[] | null {
	const value = t(format.locale, 'email.customer_journey.core.value.unavailable');
	try {
		const tiles = source
			.unavailableMetrics(request, format)
			.map(({ key, label }) => ({ key, label, value }));
		return metricsWithinBounds(source.id, tiles, source.bounds) ? tiles : null;
	} catch {
		return null;
	}
}

/**
 * Present every collected source for one recipient. A presenter that throws
 * or returns anything outside its bounds makes its source unavailable; that,
 * or tile slots outside the bounds, is logged once with a fixed code, and the
 * rejected slots are left out rather than cut.
 */
export function presentJourney<Id extends string>(
	collected: CollectedJourney<Id>,
	format: JourneyFormat
): PresentedJourney<Id> {
	const { request } = collected;
	const sources = collected.sources.map((entry): PresentedSource<Id> => {
		const { id, label, source } = entry;
		let rejected = false;
		if (entry.status === 'loaded') {
			try {
				const presentation = entry.facts.present(format);
				if (withinBounds(id, presentation, source.bounds)) {
					return {
						id,
						label,
						status: 'presented',
						coverage: entry.facts.coverage,
						...presentation
					};
				}
			} catch {
				// Same outcome as a rejected presentation below.
			}
			rejected = true;
		}
		const tiles = unavailableTiles(source, request, format);
		if (rejected || tiles === null) {
			console.warn({ code: 'journey_presentation_rejected', source: id });
		}
		return { id, label, status: 'unavailable', steps: [], metrics: tiles ?? [] };
	});
	return { request, sources };
}

/**
 * Footer lines that qualify the journey, from coverage alone, in registry
 * order: sources that could not be loaded, sources this deployment has not
 * recorded yet, sources only partly checked, and captured sources whose
 * recording started after the window opened.
 */
export function coverageNotes(presented: PresentedJourney, format: JourneyFormat): string[] {
	const { locale } = format;
	const clock = createClock(format);
	const note = (key: string, label: string, params: Record<string, string> = {}) =>
		t(locale, `email.customer_journey.core.notes.${key}`, { source: t(locale, label), ...params });

	return presented.sources.flatMap((source) => {
		if (source.status === 'unavailable') return [note('unavailable', source.label)];
		const { truncated, capture } = source.coverage;
		const notes: string[] = [];
		if (capture?.kind === 'not_started') notes.push(note('not_recorded', source.label));
		if (capture?.kind === 'started' && capture.at > presented.request.window.start) {
			notes.push(note('recorded_since', source.label, { date: clock.date(capture.at) }));
		}
		if (truncated) notes.push(note('partial', source.label));
		return notes;
	});
}

/**
 * Steps in time order. The sort is stable, so steps at the same instant keep
 * the order the composer built: that order decides where milestones sit
 * among sources.
 */
export function orderSteps(steps: readonly JourneyStep[]): JourneyStep[] {
	return [...steps].sort((a, b) => a.at - b.at);
}

/** The composer's lead tiles first, then source metrics in registry order; overflow drops tiles. */
export function pickTiles(
	lead: readonly JourneyMetric[],
	presented: PresentedJourney,
	max = 3
): JourneyMetric[] {
	return [...lead, ...presented.sources.flatMap((source) => source.metrics)].slice(0, max);
}
