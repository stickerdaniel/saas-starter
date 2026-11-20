import { getFunctionName, makeFunctionReference, type FunctionReference } from 'convex/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LOCALES, t, type SupportedLocale } from '../../i18n/translations';
import { buildJourneyTimeline, type RailTheme } from '../../emails/journeyTimeline';
import { collectJourney, coverageNotes, orderSteps, pickTiles, presentJourney } from './collect';
import { createClock, formatCount } from './format';
import {
	defineJourneySource,
	type Coverage,
	type JourneyMetric,
	type JourneyReadCtx,
	type JourneyReadLimits,
	type JourneyRequest,
	type JourneySource,
	type JourneyStep,
	type PresentationBounds
} from './source';

/**
 * Conformance of the shared core with sources it has never seen. Every source
 * here is test-only, declared the way a fork declares one, and read through a
 * stand-in for `ctx.runQuery`, so these tests depend on no app schema,
 * registry or theme and run unchanged in every app that shares the core.
 */

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
const LIMITS: JourneyReadLimits = { documentsRead: 10, bytesRead: 1024 };
// Core copy as each app words it, so apps with their own values share these tests.
const UNAVAILABLE = t('en', 'email.customer_journey.core.value.unavailable');
const notLoaded = (source: string) =>
	t('en', 'email.customer_journey.core.notes.unavailable', { source });

const ROLE = { color: '#000000' };
const THEME: RailTheme = {
	tones: {
		neutral: { dot: ROLE, title: null },
		paid: { dot: ROLE, title: ROLE },
		problem: { dot: ROLE, title: null },
		canceled: { dot: ROLE, title: ROLE }
	},
	line: ROLE,
	muted: ROLE,
	gap: ROLE
};

type TestSource = { source: JourneySource; read: () => Promise<unknown> };

/** A test-only source whose read returns `facts` and whose presenter is `present`. */
function testSource<const Id extends string, Facts extends { coverage: Coverage }>(
	id: Id,
	facts: Facts,
	present: (
		facts: Facts,
		locale: SupportedLocale
	) => { steps: JourneyStep[]; metrics: JourneyMetric[] },
	options: {
		bounds?: Partial<PresentationBounds>;
		limits?: JourneyReadLimits;
		slots?: Array<{ key: string; label: string }>;
		readFails?: boolean;
	} = {}
): TestSource {
	const read = makeFunctionReference<'query', JourneyRequest, Facts>(
		`test/${id}:read`
	) as unknown as FunctionReference<'query', 'internal', JourneyRequest, Facts>;
	const source = defineJourneySource({
		id,
		label: `Source ${id}`,
		read,
		limits: options.limits ?? LIMITS,
		bounds: options.bounds,
		present: (loaded, _request, format) => present(loaded, format.locale),
		unavailableMetrics: () => options.slots ?? []
	});
	return {
		source,
		read: options.readFails
			? async () => {
					throw new Error('read failed with private text');
				}
			: async () => facts
	};
}

/**
 * A stand-in for `ctx.runQuery` that answers each test source's read by name
 * and records what every read received.
 */
function readContext(sources: readonly TestSource[]) {
	const reads = new Map(sources.map(({ source, read }) => [`test/${source.id}:read`, read]));
	const calls: Array<{ name: string; args: unknown; limits: unknown }> = [];
	const runQuery = async (
		ref: FunctionReference<'query'>,
		args: unknown,
		options?: { transactionLimits?: unknown }
	) => {
		const name = getFunctionName(ref);
		calls.push({ name, args, limits: options?.transactionLimits });
		const read = reads.get(name);
		if (!read) throw new Error(`No test read ${name}`);
		return await read();
	};
	return { ctx: { runQuery } as unknown as JourneyReadCtx, calls };
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

async function run(sources: readonly TestSource[], locale: SupportedLocale = 'en') {
	const { ctx, calls } = readContext(sources);
	const collected = await collectJourney(
		ctx,
		sources.map((entry) => entry.source),
		REQUEST
	);
	const format = { locale, timeZone: 'UTC' };
	const presented = presentJourney(collected, format);
	const byId = (id: string) => {
		const found = presented.sources.find((source) => source.id === id);
		if (!found) throw new Error(`No source ${id}`);
		return found;
	};
	return { presented, format, byId, calls };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('journey core conformance', () => {
	it('reads each source once, with the request and its declared envelope', async () => {
		const small = testSource('small', { coverage: COMPLETE }, () => ({ steps: [], metrics: [] }));
		const large = testSource('large', { coverage: COMPLETE }, () => ({ steps: [], metrics: [] }), {
			limits: { documentsRead: 4050, bytesRead: 4 * 1024 * 1024 }
		});

		const { calls } = await run([small, large]);

		expect(calls).toEqual([
			{ name: 'test/small:read', args: REQUEST, limits: LIMITS },
			{
				name: 'test/large:read',
				args: REQUEST,
				limits: { documentsRead: 4050, bytesRead: 4 * 1024 * 1024 }
			}
		]);
	});

	it('takes a fourth source with its own facts and four tiles; its steps survive tile overflow', async () => {
		const counted = (id: string, at: number) =>
			testSource(id, { coverage: COMPLETE, count: 2 }, (facts) => ({
				steps: [step(`${id}:events`, at, `${facts.count} ${id} events`)],
				metrics: [metric(`${id}:count`, facts.count)]
			}));
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

		const { presented, format } = await run([
			counted('first', SIGNUP + 2 * HOUR),
			counted('second', SIGNUP + 3 * HOUR),
			counted('third', SIGNUP + 4 * HOUR),
			fourth
		]);
		const steps = orderSteps(presented.sources.flatMap((source) => source.steps));
		const { text } = buildJourneyTimeline(steps, coverageNotes(presented, format), format, THEME);

		expect(pickTiles([metric('lead:signup_to_paid', 1)], presented).map((t) => t.key)).toEqual([
			'lead:signup_to_paid',
			'first:count',
			'second:count'
		]);
		expect(steps.map((entry) => entry.key)).toEqual([
			'sessions:0',
			'first:events',
			'second:events',
			'third:events',
			'sessions:1'
		]);
		expect(text).toContain('Session of 12 min');
		expect(text).toContain('Session of 3 min');
	});

	it('rejects a fifth tile under the default bounds', async () => {
		const five = testSource('tiles', { coverage: COMPLETE }, () => ({
			steps: [step('tiles:one', SIGNUP, 'Still shown?')],
			metrics: [1, 2, 3, 4, 5].map((n) => metric(`tiles:m${n}`, n))
		}));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const { byId } = await run([five]);

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
			{
				slots: [
					{ key: 'throwing:a', label: 'throwing a' },
					{ key: 'throwing:b', label: 'throwing b' }
				]
			}
		);
		const failing = testSource(
			'failing',
			{ coverage: COMPLETE },
			() => ({ steps: [], metrics: [] }),
			{ slots: [{ key: 'failing:c', label: 'failing c' }], readFails: true }
		);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const { presented, format, byId } = await run([throwing, failing, healthy]);

		expect(byId('healthy')).toMatchObject({
			status: 'presented',
			steps: [{ title: 'Healthy step' }]
		});
		for (const id of ['throwing', 'failing']) {
			expect(byId(id)).toMatchObject({ status: 'unavailable', steps: [] });
		}
		expect(pickTiles([], presented, 4)).toEqual([
			{ key: 'throwing:a', label: 'throwing a', value: UNAVAILABLE, unknown: true },
			{ key: 'throwing:b', label: 'throwing b', value: UNAVAILABLE, unknown: true },
			{ key: 'failing:c', label: 'failing c', value: UNAVAILABLE, unknown: true },
			metric('healthy:count', 7)
		]);
		expect(coverageNotes(presented, format)).toEqual([
			notLoaded('Source throwing'),
			notLoaded('Source failing')
		]);
		expect(warn.mock.calls).toEqual([
			[{ code: 'journey_source_unavailable', source: 'failing' }],
			[{ code: 'journey_presentation_rejected', source: 'throwing' }]
		]);
		expect(JSON.stringify(warn.mock.calls)).not.toContain('private text');
	});

	it.each([
		['five slots', Array.from({ length: 5 }, (_, i) => ({ key: `down:${i}`, label: `slot ${i}` }))],
		['an oversized label', [{ key: 'down:a', label: 'x'.repeat(10_000) }]],
		["another source's key", [{ key: 'other:a', label: 'borrowed' }]]
	])('rejects tile slots with %s instead of showing or cutting them', async (_case, slots) => {
		const down = testSource('down', { coverage: COMPLETE }, () => ({ steps: [], metrics: [] }), {
			slots,
			readFails: true
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const { presented, byId } = await run([down]);

		expect(byId('down')).toMatchObject({ status: 'unavailable', steps: [], metrics: [] });
		expect(pickTiles([], presented)).toEqual([]);
		expect(warn.mock.calls).toEqual([
			[{ code: 'journey_source_unavailable', source: 'down' }],
			[{ code: 'journey_presentation_rejected', source: 'down' }]
		]);
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

		const { presented, byId } = await run([oversize]);

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

		const { presented } = await run(shapes, locale);

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
			THEME
		);

		expect(text.split('\n').filter((line) => line.includes('('))).toEqual([
			'Sent 2 AI chat messages (Tue, Oct 6, 08:12)',
			'Signed up (09:12)',
			'Paid $10.00 (09:12)',
			'First recorded support contact (09:12)'
		]);
	});
});
