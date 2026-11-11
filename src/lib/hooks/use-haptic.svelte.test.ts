import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/env', () => ({ browser: true, dev: true, building: false, version: 'test' }));
vi.mock('web-haptics', () => ({
	WebHaptics: class {
		trigger() {}
		cancel() {}
		destroy() {}
		setDebug() {}
	}
}));

import { UseHaptic } from './use-haptic.svelte.ts';

describe('UseHaptic', () => {
	beforeAll(async () => {
		// The engine class loads through a dynamic import at module scope
		await vi.dynamicImportSettled();
	});

	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('matchMedia', () => ({
			matches: false,
			addEventListener() {},
			removeEventListener() {}
		}));
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('clears isActive after the first trigger', async () => {
		const haptic = new UseHaptic();

		haptic.trigger(200);
		expect(haptic.isActive).toBe(true);

		await vi.advanceTimersByTimeAsync(199);
		expect(haptic.isActive).toBe(true);
		await vi.advanceTimersByTimeAsync(1);
		expect(haptic.isActive).toBe(false);
	});

	it('clears isActive after the last of rapid repeat triggers', async () => {
		const haptic = new UseHaptic();

		haptic.trigger(200);
		await vi.advanceTimersByTimeAsync(150);
		haptic.trigger([50, 30, 70]);
		haptic.trigger('success');

		await vi.advanceTimersByTimeAsync(99);
		expect(haptic.isActive).toBe(true);
		await vi.advanceTimersByTimeAsync(1);
		expect(haptic.isActive).toBe(false);
	});

	it('clears isActive when triggered right after cancel', async () => {
		const haptic = new UseHaptic();

		haptic.cancel();
		haptic.trigger(100);

		await vi.advanceTimersByTimeAsync(100);
		expect(haptic.isActive).toBe(false);
	});
});
