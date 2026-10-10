import { makeFunctionReference, type FunctionReference } from 'convex/server';
import { describe, expect, it } from 'vitest';
import { ensureCaptureStart } from '../capture';
import { collectJourney, coverageNotes, orderSteps, pickTiles, presentJourney } from '../collect';
import { createJourneyStore } from '../journeyStore.fixtures';
import { JOURNEY_SOURCES } from '../registry';
import {
	defineJourneySource,
	type Coverage,
	type JourneyRequest,
	type JourneySource
} from '../source';
import * as aiChat from './aiChat';
import * as community from './community';
import * as support from './support';

type Registered = { _handler: (ctx: never, args: never) => Promise<unknown> };
const asRegistered = (fn: unknown) => fn as Registered;

const USER = 'user_journey';
const OTHER = 'user_other';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Tue, Oct 6, 09:12 UTC. */
const SIGNUP = Date.UTC(2026, 9, 6, 9, 12);
const FORMAT = { locale: 'en', timeZone: 'UTC' } as const;

function setup(overrides: Record<string, Registered> = {}) {
	const store = createJourneyStore({
		functions: {
			'admin/journey/sources/aiChat:read': asRegistered(aiChat.read),
			'admin/journey/sources/aiChat:countPartition': asRegistered(aiChat.countPartition),
			'admin/journey/sources/community:read': asRegistered(community.read),
			'admin/journey/sources/community:countPartition': asRegistered(community.countPartition),
			'admin/journey/sources/support:read': asRegistered(support.read),
			...overrides
		}
	});
	let threads = 0;
	const seed = {
		capture(source: string, startedAt: number) {
			store.insert('journeyCaptureStarts', { source, startedAt });
		},
		receipt(at: number, userId = USER) {
			store.insert('aiChatMessageReceipts', { userId }, at);
		},
		message(at: number, settled = true, body = 'hello') {
			store.insert(
				'messages',
				{ userId: USER, body, quotaSettledAt: settled ? at : undefined },
				at
			);
		},
		contact(firstUserMessageAt: number, createdAt = firstUserMessageAt, searchText = '') {
			store.insert(
				'supportThreads',
				{
					threadId: `thread_${threads++}`,
					userId: USER,
					status: 'open',
					createdAt,
					updatedAt: firstUserMessageAt,
					firstUserMessageAt,
					searchText
				},
				createdAt
			);
		}
	};
	async function journey(
		request: JourneyRequest,
		sources: readonly JourneySource[] = JOURNEY_SOURCES
	) {
		const collected = await store.mutate((ctx) => collectJourney(ctx as never, sources, request));
		const presented = presentJourney(collected, FORMAT);
		const source = (id: string) => {
			const found = presented.sources.find((entry) => entry.id === id);
			if (!found) throw new Error(`No source ${id}`);
			return found;
		};
		return { presented, source, notes: coverageNotes(presented, FORMAT) };
	}
	return { store, seed, journey };
}

const newCustomer = (paymentAt: number, end = paymentAt): JourneyRequest => ({
	episode: 'new_customer',
	userId: USER,
	signupAt: SIGNUP,
	paymentAt,
	window: { start: SIGNUP, end }
});

const captureAll = (seed: ReturnType<typeof setup>['seed'], at = SIGNUP - DAY) => {
	for (const source of ['aiChat', 'community', 'support']) seed.capture(source, at);
};

const titles = (source: { steps: Array<{ title: string }> }) => source.steps.map((s) => s.title);

describe('template journey sources', () => {
	it('splits activity at the payment and counts an event exactly at the payment once', async () => {
		const { seed, journey } = setup();
		captureAll(seed);
		const paymentAt = SIGNUP + DAY;
		for (const at of [SIGNUP + HOUR, SIGNUP + 2 * HOUR, SIGNUP + 3 * HOUR]) seed.receipt(at);
		seed.receipt(paymentAt);
		seed.receipt(paymentAt + HOUR);
		seed.receipt(paymentAt + HOUR, OTHER);
		seed.message(SIGNUP + HOUR);
		seed.message(SIGNUP + 2 * HOUR, false);
		seed.message(paymentAt);
		seed.contact(SIGNUP + 4 * HOUR);
		seed.contact(paymentAt);
		// After the window: not part of this email.
		seed.receipt(paymentAt + 7 * HOUR);

		const { source } = await journey(newCustomer(paymentAt, paymentAt + 6 * HOUR));

		expect(titles(source('aiChat'))).toEqual([
			'Sent 3 AI chat messages',
			'Sent 2 AI chat messages'
		]);
		expect(source('aiChat').steps.map((step) => step.at)).toEqual([SIGNUP + HOUR, paymentAt]);
		expect(source('aiChat').steps[0]?.lines).toEqual(['First 10:12, last 12:12']);
		expect(source('aiChat').metrics).toEqual([
			{
				key: 'aiChat:before_paying',
				label: 'AI chat messages before paying',
				value: '3',
				count: { n: 3, lowerBound: false }
			}
		]);
		expect(titles(source('community'))).toEqual([
			'Sent 1 community message',
			'Sent 1 community message'
		]);
		expect(source('community').metrics[0]?.count).toEqual({ n: 1, lowerBound: false });
		expect(titles(source('support'))).toEqual([
			'First recorded support contact',
			'First recorded support contact'
		]);
		expect(source('support').steps.map((step) => step.at)).toEqual([SIGNUP + 4 * HOUR, paymentAt]);
	});

	it('counts a window that starts after signup as one total, not as before paying', async () => {
		const { seed, journey } = setup();
		captureAll(seed);
		const paymentAt = SIGNUP + DAY;
		seed.receipt(SIGNUP + HOUR);
		seed.receipt(SIGNUP + 3 * DAY);
		seed.receipt(SIGNUP + 4 * DAY);

		const { source } = await journey({
			episode: 'cancellation',
			userId: USER,
			signupAt: SIGNUP,
			paymentAt,
			window: { start: SIGNUP + 2 * DAY, end: SIGNUP + 5 * DAY }
		});

		expect(titles(source('aiChat'))).toEqual(['Sent 2 AI chat messages']);
		expect(source('aiChat').metrics).toEqual([
			{
				key: 'aiChat:window',
				label: 'AI chat messages',
				value: '2',
				count: { n: 2, lowerBound: false }
			}
		]);
	});

	it('says "at least" for a cut-short read and calls its last time observed', async () => {
		const { seed, journey } = setup();
		captureAll(seed);
		const paymentAt = SIGNUP + 2 * DAY;
		for (let i = 0; i < 2001; i++) seed.receipt(SIGNUP + i * MINUTE);

		const { source, notes } = await journey(newCustomer(paymentAt));

		const chat = source('aiChat');
		expect(titles(chat)).toEqual(['Sent at least 2,000 AI chat messages']);
		expect(chat.steps[0]?.lines).toEqual(['First 09:12, last observed Wed, Oct 7, 18:31']);
		expect(chat.metrics[0]).toMatchObject({
			value: 'at least 2,000',
			count: { n: 2000, lowerBound: true }
		});
		expect(notes).toEqual(['AI chat messages: only partly checked, so counts are minimums.']);
	});

	it('reports a cut-short read that counted nothing as none found, never zero', async () => {
		const { seed, journey } = setup();
		captureAll(seed);
		// Pending messages are read but not counted.
		for (let i = 0; i < 2001; i++) seed.message(SIGNUP + i * MINUTE, false);

		const { source, notes } = await journey(newCustomer(SIGNUP + 2 * DAY));

		expect(source('community').steps).toEqual([]);
		expect(source('community').metrics[0]).toMatchObject({
			value: 'none found in the checked records',
			count: { n: 0, lowerBound: true }
		});
		expect(notes).toEqual(['Community messages: only partly checked, so counts are minimums.']);
	});

	it('shows a failed source as unavailable, with no count, and keeps the others', async () => {
		const { seed, journey } = setup({
			'admin/journey/sources/aiChat:countPartition': {
				_handler: async () => {
					throw new Error('read limit');
				}
			}
		});
		captureAll(seed);
		seed.receipt(SIGNUP + HOUR);
		seed.message(SIGNUP + HOUR);

		const { source, notes } = await journey(newCustomer(SIGNUP + DAY));

		expect(source('aiChat')).toMatchObject({ status: 'unavailable', steps: [] });
		expect(source('aiChat').metrics).toEqual([
			{ key: 'aiChat:before_paying', label: 'AI chat messages before paying', value: 'unavailable' }
		]);
		expect(titles(source('community'))).toEqual(['Sent 1 community message']);
		expect(notes).toEqual(['AI chat messages: could not be loaded for this email.']);
	});

	it('says "not recorded yet" for a source this deployment never captured, never zero', async () => {
		const { seed, journey } = setup();
		seed.capture('aiChat', SIGNUP - DAY);
		seed.capture('support', SIGNUP - DAY);
		// Old history from before capture existed: unsettled, no marker.
		seed.message(SIGNUP + HOUR, false);

		const { source, notes } = await journey(newCustomer(SIGNUP + DAY));

		expect(source('community').steps).toEqual([]);
		expect(source('community').metrics).toEqual([
			{
				key: 'community:before_paying',
				label: 'community messages before paying',
				value: 'not recorded yet'
			}
		]);
		expect(notes).toEqual(['Community messages: not recorded yet.']);
	});

	it('notes when recording started after the window opened', async () => {
		const { seed, journey } = setup();
		seed.capture('aiChat', SIGNUP - DAY);
		seed.capture('community', SIGNUP);
		seed.capture('support', SIGNUP + DAY + HOUR);

		const { notes } = await journey(newCustomer(SIGNUP + 2 * DAY));

		expect(notes).toEqual(['Support contacts: recorded since Wed, Oct 7.']);
	});

	it('counts facts retained across a capture reset under "recorded since" the reset', async () => {
		const { store, seed, journey } = setup();
		const reset = SIGNUP + DAY + HOUR;
		seed.capture('community', SIGNUP - DAY);
		seed.capture('support', SIGNUP - DAY);
		// Recorded before the capture was reverted; the marker was then moved to
		// the re-enable time (rollback runbook), and the facts were kept.
		seed.receipt(SIGNUP + HOUR);
		seed.receipt(SIGNUP + 2 * HOUR);
		seed.capture('aiChat', reset);
		const request = newCustomer(SIGNUP + 3 * DAY);

		const beforeCapture = await journey(request);
		expect(beforeCapture.source('aiChat').metrics[0]?.count).toEqual({ n: 2, lowerBound: false });
		expect(beforeCapture.notes).toEqual(['AI chat messages: recorded since Wed, Oct 7.']);

		// The first capture after the reset leaves the marker where it is.
		await store.mutate(async (ctx) => {
			await ensureCaptureStart(ctx as never, 'aiChat');
			await ctx.db.insert('aiChatMessageReceipts', { userId: USER });
		});
		seed.receipt(SIGNUP + 2 * DAY);

		const afterCapture = await journey(request);
		expect(afterCapture.source('aiChat').metrics[0]?.count).toEqual({ n: 3, lowerBound: false });
		expect(afterCapture.notes).toEqual(['AI chat messages: recorded since Wed, Oct 7.']);
	});

	it('counts an old support thread by its first recorded message, not its creation', async () => {
		const { seed, journey } = setup();
		captureAll(seed);
		const paymentAt = SIGNUP + DAY;
		const canceledAt = SIGNUP + 70 * DAY;
		const windowStart = canceledAt - 30 * DAY;
		// Created long before the window; first written to after capture began.
		seed.contact(windowStart + 5 * DAY, SIGNUP + 2 * DAY);
		// Created inside the window, but the owner never wrote in it.
		seed.contact(windowStart - DAY, windowStart + DAY);

		const { source } = await journey({
			episode: 'cancellation',
			userId: USER,
			signupAt: SIGNUP,
			paymentAt,
			window: { start: windowStart, end: canceledAt }
		});

		expect(titles(source('support'))).toEqual(['First recorded support contact']);
		expect(source('support').steps[0]?.at).toBe(windowStart + 5 * DAY);
	});

	it('marks only the side of the payment a cut-short support read may be missing', async () => {
		const { seed, journey } = setup();
		captureAll(seed);
		const paymentAt = SIGNUP + DAY;
		for (let i = 0; i < 30; i++) seed.contact(SIGNUP + i * MINUTE);
		for (let i = 0; i < 25; i++) seed.contact(paymentAt + i * MINUTE);

		const { source } = await journey(newCustomer(paymentAt, paymentAt + DAY));

		expect(source('support').steps.map(({ title, lines }) => ({ title, lines }))).toEqual([
			{
				title: 'First recorded support contacts in 30 threads',
				lines: ['First 09:12, last 09:41']
			},
			{
				title: 'First recorded support contacts in at least 20 threads',
				lines: ['First 09:12, last observed 09:31']
			}
		]);
	});

	// The store meters the read against the source's 2 MiB envelope, so a read
	// over it would leave support unavailable.
	it('reads support threads near the document size limit inside its envelope, as a cut-short read', async () => {
		const { seed, journey } = setup();
		captureAll(seed);
		for (let i = 0; i < 4; i++) seed.contact(SIGNUP + i * MINUTE, SIGNUP, 'x'.repeat(900_000));

		const { source, notes } = await journey(newCustomer(SIGNUP + DAY));

		expect(source('support')).toMatchObject({ status: 'presented', coverage: { truncated: true } });
		expect(source('support').steps.map(({ at, title }) => ({ at, title }))).toEqual([
			{ at: SIGNUP, title: 'First recorded support contacts in at least 1 thread' }
		]);
		expect(notes).toEqual(['Support contacts: only partly checked, so counts are minimums.']);
	});

	it.each([
		{ threads: 50, truncated: false },
		{ threads: 51, truncated: true }
	])(
		'reports $threads support threads as truncated: $truncated',
		async ({ threads, truncated }) => {
			const { seed, journey } = setup();
			captureAll(seed);
			for (let i = 0; i < threads; i++) seed.contact(SIGNUP + i * MINUTE);

			const { source } = await journey(newCustomer(SIGNUP + DAY));

			expect(source('support')).toMatchObject({ status: 'presented', coverage: { truncated } });
		}
	);

	it("takes a fork's fourth source beside the demo sources, keeping its steps when its tiles overflow", async () => {
		type SessionFacts = { coverage: Coverage; sessions: number[] };
		const sessions = defineJourneySource({
			id: 'sessions',
			label: 'Sessions',
			read: makeFunctionReference<'query', JourneyRequest, SessionFacts>(
				'test/sessions:read'
			) as unknown as FunctionReference<'query', 'internal', JourneyRequest, SessionFacts>,
			limits: { documentsRead: 10, bytesRead: 1024 },
			present: (facts) => ({
				steps: facts.sessions.map((at, index) => ({
					key: `sessions:${index}`,
					at,
					title: `Session ${index}`,
					lines: [],
					tone: 'neutral' as const
				})),
				metrics: [1, 2, 3, 4].map((n) => ({ key: `sessions:m${n}`, label: `m${n}`, value: `${n}` }))
			})
		});
		const facts: SessionFacts = { coverage: { truncated: false }, sessions: [SIGNUP + HOUR] };
		const { seed, journey } = setup({ 'test/sessions:read': { _handler: async () => facts } });
		captureAll(seed);
		seed.receipt(SIGNUP + 2 * HOUR);

		const { presented } = await journey(newCustomer(SIGNUP + DAY), [...JOURNEY_SOURCES, sessions]);

		expect(pickTiles([], presented).map((tile) => tile.key)).toEqual([
			'aiChat:before_paying',
			'community:before_paying',
			'sessions:m1'
		]);
		expect(
			orderSteps(presented.sources.flatMap((source) => source.steps)).map((s) => s.key)
		).toEqual(['sessions:0', 'aiChat:before']);
	});
});

// The sender's read budget (plan 4.5) gives the sources 8,200 documents and
// 8 MiB together, beside recipient discovery and its own reserve.
describe('demo source envelopes', () => {
	it("sum to at most the sources' share of the sender's read budget", () => {
		const total = JOURNEY_SOURCES.reduce(
			(sum, { limits }) => ({
				documentsRead: sum.documentsRead + limits.documentsRead,
				bytesRead: sum.bytesRead + limits.bytesRead
			}),
			{ documentsRead: 0, bytesRead: 0 }
		);
		expect(total.documentsRead).toBeLessThanOrEqual(8_200);
		expect(total.bytesRead).toBeLessThanOrEqual(8 * 1024 * 1024);
	});
});
