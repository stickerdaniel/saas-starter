import { makeFunctionReference, type FunctionReference } from 'convex/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LOCALES, type SupportedLocale } from '../../i18n/translations';
import { buildJourneyTimeline } from '../../emails/journeyTimeline';
import { collectJourney, coverageNotes, orderSteps, pickTiles, presentJourney } from './collect';
import { createClock, formatCount } from './format';
import { createJourneyStore } from './journeyStore.fixtures';
import { JOURNEY_SOURCES } from './registry';
import {
	defineJourneySource,
	type Coverage,
	type JourneyMetric,
	type JourneyRequest,
	type JourneySource,
	type JourneyStep,
	type PresentationBounds
} from './source';
import * as aiChat from './sources/aiChat';
import * as community from './sources/community';
import * as support from './sources/support';
import { JOURNEY_RAIL_THEME } from './theme';

/**
 * Conformance of the shared core with sources it has never seen: each source
 * here is test-only, declared the way a fork declares one, and run through the
 * same collect, present, tile and render path as the template's own.
 */

type Registered = { _handler: (ctx: never, args: never) => Promise<unknown> };
const asRegistered = (fn: unknown) => fn as Registered;

const USER = 'user_journey';
const HOUR = 3_600_000;
const SIGNUP = Date.UTC(2026, 9, 6, 9, 12);
const PAID = SIGNUP + 2 * 24 * HOUR;
const REQUEST: JourneyRequest = {
	episode: 'new_customer',
	userId: USER,
	signupAt: SIGNUP,
	paymentAt: PAID,
	window: { start: SIGNUP, end: PAID }
};
const COMPLETE: Coverage = { truncated: false };

/** A reference to a test-only internal query, registered with the store by name. */
function testRead<Facts>(name: string) {
	return makeFunctionReference<'query', JourneyRequest, Facts>(
		name
	) as unknown as FunctionReference<'query', 'internal', JourneyRequest, Facts>;
}

/** A test-only source whose read returns `facts` and whose presenter is `present`. */
function testSource<const Id extends string, Facts extends { coverage: Coverage }>(
	id: Id,
	facts: Facts,
	present: (
		facts: Facts,
		locale: SupportedLocale
	) => { steps: JourneyStep[]; metrics: JourneyMetric[] },
	options: { bounds?: Partial<PresentationBounds>; slots?: string[]; readFails?: boolean } = {}
) {
	const source = defineJourneySource({
		id,
		label: `Source ${id}`,
		read: testRead<Facts>(`test/${id}:read`),
		limits: { documentsRead: 10, bytesRead: 1024 },
		bounds: options.bounds,
		present: (loaded, _request, format) => present(loaded, format.locale),
		unavailableMetrics: () =>
			(options.slots ?? []).map((name) => ({ key: `${id}:${name}`, label: `${id} ${name}` }))
	});
	const handler = options.readFails
		? async () => {
				throw new Error('read failed with private text');
			}
		: async () => facts;
	return { source, functions: { [`test/${id}:read`]: { _handler: handler } } };
}

const step = (key: string, at: number, title: string, lines: string[] = []): JourneyStep => ({
	key,
	at,
	title,
	lines,
	tone: 'neutral'
});

const metric = (key: string, n: number): JourneyMetric => ({
	key,
	label: key,
	value: formatCount(n, false, 'en'),
	count: { n, lowerBound: false }
});

function storeWith(...entries: Array<{ functions: Record<string, Registered> }>) {
	return createJourneyStore({
		functions: Object.assign(
			{
				'admin/journey/sources/aiChat:read': asRegistered(aiChat.read),
				'admin/journey/sources/aiChat:countPartition': asRegistered(aiChat.countPartition),
				'admin/journey/sources/community:read': asRegistered(community.read),
				'admin/journey/sources/community:countPartition': asRegistered(community.countPartition),
				'admin/journey/sources/support:read': asRegistered(support.read)
			},
			...entries.map((entry) => entry.functions)
		)
	});
}

async function run(
	sources: readonly JourneySource[],
	store: ReturnType<typeof storeWith>,
	locale: SupportedLocale = 'en'
) {
	const collected = await store.mutate((ctx) => collectJourney(ctx as never, sources, REQUEST));
	const format = { locale, timeZone: 'UTC' };
	const presented = presentJourney(collected, format);
	const byId = (id: string) => {
		const found = presented.sources.find((source) => source.id === id);
		if (!found) throw new Error(`No source ${id}`);
		return found;
	};
	return { presented, format, byId };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('journey core conformance', () => {
	it('takes a fourth source with its own facts and four tiles; its steps survive tile overflow', async () => {
		const fourth = testSource(
			'sessions',
			{
				coverage: COMPLETE,
				sessions: [
					{ at: SIGNUP + HOUR, minutes: 12 },
					{ at: SIGNUP + 30 * HOUR, minutes: 3 }
				]
			},
			(facts) => ({
				steps: facts.sessions.map((session, index) =>
					step(`sessions:${index}`, session.at, `Session of ${session.minutes} min`)
				),
				metrics: [1, 2, 3, 4].map((n) => metric(`sessions:m${n}`, n))
			})
		);
		const store = storeWith(fourth);
		for (const source of ['aiChat', 'community', 'support']) {
			store.insert('journeyCaptureStarts', { source, startedAt: 0 });
		}
		store.insert('aiChatMessageReceipts', { userId: USER }, SIGNUP + 2 * HOUR);

		const { presented, format } = await run([...JOURNEY_SOURCES, fourth.source], store);
		const steps = orderSteps(presented.sources.flatMap((source) => source.steps));
		const { text } = buildJourneyTimeline(
			steps,
			coverageNotes(presented, format),
			format,
			JOURNEY_RAIL_THEME
		);

		expect(pickTiles([metric('lead:signup_to_paid', 1)], presented).map((t) => t.key)).toEqual([
			'lead:signup_to_paid',
			'aiChat:before_paying',
			'community:before_paying'
		]);
		expect(steps.map((entry) => entry.key)).toEqual(['sessions:0', 'aiChat:before', 'sessions:1']);
		expect(text).toContain('Session of 12 min');
		expect(text).toContain('Session of 3 min');
	});

	it('rejects a fifth tile under the default bounds', async () => {
		const five = testSource('tiles', { coverage: COMPLETE }, () => ({
			steps: [step('tiles:one', SIGNUP, 'Still shown?')],
			metrics: [1, 2, 3, 4, 5].map((n) => metric(`tiles:m${n}`, n))
		}));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const { byId } = await run([five.source], storeWith(five));

		expect(byId('tiles')).toMatchObject({ status: 'unavailable', steps: [], metrics: [] });
		expect(warn).toHaveBeenCalledWith({ code: 'journey_presentation_rejected', source: 'tiles' });
	});

	it('isolates a throwing presenter and a failing read, keeping their tile slots without a count', async () => {
		const healthy = testSource('healthy', { coverage: COMPLETE }, () => ({
			steps: [step('healthy:one', SIGNUP, 'Healthy step')],
			metrics: [metric('healthy:count', 7)]
		}));
		const throwing = testSource(
			'throwing',
			{ coverage: COMPLETE },
			() => {
				throw new Error('presenter bug');
			},
			{ slots: ['a', 'b'] }
		);
		const failing = testSource(
			'failing',
			{ coverage: COMPLETE },
			() => ({ steps: [], metrics: [] }),
			{ slots: ['c'], readFails: true }
		);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const { presented, format, byId } = await run(
			[throwing.source, failing.source, healthy.source],
			storeWith(healthy, throwing, failing)
		);

		expect(byId('healthy')).toMatchObject({
			status: 'presented',
			steps: [{ title: 'Healthy step' }]
		});
		for (const id of ['throwing', 'failing']) {
			expect(byId(id)).toMatchObject({ status: 'unavailable', steps: [] });
		}
		expect(pickTiles([], presented, 4)).toEqual([
			{ key: 'throwing:a', label: 'throwing a', value: 'unavailable' },
			{ key: 'throwing:b', label: 'throwing b', value: 'unavailable' },
			{ key: 'failing:c', label: 'failing c', value: 'unavailable' },
			metric('healthy:count', 7)
		]);
		expect(coverageNotes(presented, format)).toEqual([
			'Source throwing: could not be loaded for this email.',
			'Source failing: could not be loaded for this email.'
		]);
		expect(warn.mock.calls).toEqual([
			[{ code: 'journey_source_unavailable', source: 'failing' }],
			[{ code: 'journey_presentation_rejected', source: 'throwing' }]
		]);
		expect(JSON.stringify(warn.mock.calls)).not.toContain('private text');
	});

	it('rejects an oversized presentation instead of cutting it', async () => {
		const long = 'x'.repeat(10_000);
		const oversize = testSource('oversize', { coverage: COMPLETE }, () => ({
			steps: Array.from({ length: 6 }, (_, index) =>
				step(`oversize:${index}`, SIGNUP + index, `Step ${index}`, index === 3 ? [long] : [])
			),
			metrics: []
		}));
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const { presented, byId } = await run([oversize.source], storeWith(oversize));

		expect(byId('oversize')).toMatchObject({ status: 'unavailable', steps: [] });
		expect(JSON.stringify(presented)).not.toContain('x'.repeat(100));
	});

	// Shapes Cadenza's sources produce today, each under the bounds its source declares.
	it.each(SUPPORTED_LOCALES)('presents larger declared shapes in %s', async (locale) => {
		const clock = createClock({ locale, timeZone: 'UTC' });
		const count = (n: number) => formatCount(n, false, locale);
		const shapes = [
			testSource(
				'counter',
				{ coverage: COMPLETE },
				() => ({
					steps: [
						step('counter:full', SIGNUP, 'Daily limit reached', [
							'Per endpoint day limit, per 1 day',
							'Method: get_person_profile',
							`Used ${count(1500)} of ${count(1500)}`,
							`Window ends ${clock.time(SIGNUP + 20 * HOUR, SIGNUP)}`,
							'Counter time, not the time of the call'
						])
					],
					metrics: []
				}),
				{ bounds: { linesPerStep: 5 } }
			),
			testSource(
				'limits',
				{ coverage: COMPLETE },
				() => ({
					steps: [
						step(
							'limits:saved',
							SIGNUP,
							'Saved custom limits',
							Array.from({ length: 6 }, (_, i) => `Limiter ${i}, per 1 day: ${count(10_000)}`)
						)
					],
					metrics: []
				}),
				{ bounds: { linesPerStep: 6 } }
			),
			testSource(
				'mcp',
				{ coverage: COMPLETE },
				() => ({
					steps: Array.from({ length: 7 }, (_, i) =>
						step(`mcp:${i}`, SIGNUP + i * HOUR, `Connected MCP client Claude Desktop ${i}`, [
							'Authorized through OAuth'
						])
					),
					metrics: []
				}),
				{ bounds: { steps: 10 } }
			),
			testSource(
				'voice',
				{ coverage: COMPLETE },
				() => ({
					steps: Array.from({ length: 7 }, (_, i) =>
						step(`voice:${i}`, SIGNUP + i * HOUR, 'Voice training failed', [
							'Direct messages: not enough history'
						])
					),
					metrics: []
				}),
				{ bounds: { steps: 7 } }
			),
			testSource(
				'errors',
				{ coverage: { truncated: true } },
				() => ({
					steps: [
						step(
							'errors:groups',
							SIGNUP,
							`${formatCount(12, true, locale, true)} recorded errors`,
							Array.from(
								{ length: 5 },
								(_, i) =>
									`LinkedIn connection: AUTH_${i}, ${formatCount(3, true, locale)} times, first ${clock.time(SIGNUP, SIGNUP)}, last ${clock.time(SIGNUP + 30 * HOUR, SIGNUP)}`
							)
						)
					],
					metrics: [
						{
							key: 'errors:count',
							label: 'recorded errors',
							value: formatCount(0, true, locale),
							count: { n: 0, lowerBound: true }
						}
					]
				}),
				{ bounds: { linesPerStep: 5 } }
			)
		];
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const { presented } = await run(
			shapes.map((shape) => shape.source),
			storeWith(...shapes),
			locale
		);

		expect(presented.sources.map((source) => [source.id, source.status])).toEqual(
			shapes.map((shape) => [shape.source.id, 'presented'])
		);
		expect(presented.sources.map((source) => source.steps.length)).toEqual([1, 1, 7, 7, 1]);
		expect(warn).not.toHaveBeenCalled();
	});

	it('keeps the composed order for steps at the same instant', () => {
		// The composer puts a source's signup step before the payment milestone,
		// here for a customer who paid within the same second.
		const composed = [
			step('signup:signed_up', SIGNUP, 'Signed up'),
			{ ...step('paid:paid', SIGNUP, 'Paid $10.00'), tone: 'paid' as const },
			step('aiChat:before', SIGNUP - HOUR, 'Sent 2 AI chat messages'),
			step('support:after', SIGNUP, 'First recorded support contact')
		];

		const { text } = buildJourneyTimeline(
			orderSteps(composed),
			[],
			{ locale: 'en', timeZone: 'UTC' },
			JOURNEY_RAIL_THEME
		);

		expect(text.split('\n').filter((line) => line.includes('('))).toEqual([
			'Sent 2 AI chat messages (Tue, Oct 6, 08:12)',
			'Signed up (09:12)',
			'Paid $10.00 (09:12)',
			'First recorded support contact (09:12)'
		]);
	});
});
