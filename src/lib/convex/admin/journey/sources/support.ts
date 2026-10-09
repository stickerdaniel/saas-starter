import { v, type Infer } from 'convex/values';
import { internal } from '../../../_generated/api';
import { internalQuery } from '../../../_generated/server';
import { t } from '../../../i18n/translations';
import { createClock, formatCount } from '../format';
import {
	coverageValidator,
	defineJourneySource,
	journeyRequestFields,
	type JourneySource,
	type JourneyStep
} from '../source';
import { readCapture } from './partitions';

/**
 * First recorded support contacts: support threads whose owner first wrote
 * (an ordinary message or the handoff request) inside the window. Nothing
 * else about support activity is claimed; an old thread counts once its first
 * recorded message falls inside the window.
 */

const MiB = 1024 * 1024;

/** Threads read per email; one more is the truncation sentinel. */
const THREADS_CHECKED = 50;

const COPY = {
	step: {
		one: 'email.customer_journey.source.support.step.one',
		many: 'email.customer_journey.source.support.step.many'
	},
	range: {
		complete: 'email.customer_journey.source.support.range.complete',
		observed: 'email.customer_journey.source.support.range.observed'
	}
} as const;

const supportFactsValidator = v.object({
	coverage: coverageValidator,
	/** First-contact times of the checked threads, earliest first. */
	contacts: v.array(v.number())
});
type SupportFacts = Infer<typeof supportFactsValidator>;

export const read = internalQuery({
	args: journeyRequestFields,
	returns: supportFactsValidator,
	handler: async (ctx, { userId, window }): Promise<SupportFacts> => {
		const capture = await readCapture(ctx, 'support');
		if (capture.kind === 'not_started') {
			return { coverage: { truncated: false, capture }, contacts: [] };
		}
		const threads = await ctx.db
			.query('supportThreads')
			.withIndex('by_user_and_first_user_message', (q) =>
				q
					.eq('userId', userId)
					.gte('firstUserMessageAt', window.start)
					.lte('firstUserMessageAt', window.end)
			)
			.take(THREADS_CHECKED + 1);
		return {
			coverage: { truncated: threads.length > THREADS_CHECKED, capture },
			contacts: threads
				.slice(0, THREADS_CHECKED)
				.flatMap(({ firstUserMessageAt: at }) => (at === undefined ? [] : [at]))
		};
	}
});

export const supportSource: JourneySource<'support'> = defineJourneySource({
	id: 'support',
	label: 'email.customer_journey.source.support.label',
	read: internal.admin.journey.sources.support.read,
	// The marker plus at most 51 threads.
	limits: { documentsRead: 100, bytesRead: 2 * MiB },
	present({ coverage, contacts }, { paymentAt }, format) {
		const { locale } = format;
		const clock = createClock(format);
		const before = contacts.filter((at) => at < paymentAt);
		const after = contacts.filter((at) => at >= paymentAt);
		// A cut-short read checked the earliest threads, so only the side of the
		// payment holding its last checked contact may be missing threads.
		const cutAfter = coverage.truncated && after.length > 0;
		const cutBefore = coverage.truncated && !cutAfter;

		const step = (
			name: 'before' | 'after',
			times: number[],
			lowerBound: boolean
		): JourneyStep[] => {
			const first = times[0];
			const last = times[times.length - 1];
			if (first === undefined || last === undefined) return [];
			const single = times.length === 1 && !lowerBound;
			return [
				{
					key: `support:${name}`,
					at: first,
					title: single
						? t(locale, COPY.step.one)
						: t(locale, COPY.step.many, {
								count: formatCount(times.length, lowerBound, locale)
							}),
					lines: single
						? []
						: [
								t(locale, lowerBound ? COPY.range.observed : COPY.range.complete, {
									first: clock.time(first, first),
									last: clock.time(last, first)
								})
							],
					tone: 'problem'
				}
			];
		};

		return {
			steps: [...step('before', before, cutBefore), ...step('after', after, cutAfter)],
			metrics: []
		};
	}
});
