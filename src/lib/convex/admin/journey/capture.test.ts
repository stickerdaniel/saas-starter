import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureCaptureStart } from './capture';
import { createJourneyStore } from './journeyStore.fixtures';

const START = Date.UTC(2026, 9, 8, 12);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(START);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('ensureCaptureStart', () => {
	// The store runs mutations one at a time, the outcome Convex OCC gives
	// producers that read the same index range before inserting.
	it('records one start per source under concurrent producers and never moves it', async () => {
		const store = createJourneyStore();
		const produce = (source: string) =>
			store.mutate((ctx) => ensureCaptureStart(ctx as never, source));

		await Promise.all([
			produce('aiChat'),
			produce('support'),
			produce('aiChat'),
			produce('support'),
			produce('aiChat')
		]);
		vi.setSystemTime(START + 60_000);
		await Promise.all([produce('aiChat'), produce('support')]);

		expect(
			store
				.docs('journeyCaptureStarts')
				.map(({ source, startedAt }) => ({ source: String(source), startedAt }))
				.sort((a, b) => a.source.localeCompare(b.source))
		).toEqual([
			{ source: 'aiChat', startedAt: START },
			{ source: 'support', startedAt: START }
		]);
	});
});
