import type * as EsmEnv from 'esm-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const engine = { loads: 0, triggers: [] as unknown[] };

async function loadUnder(condition: 'browser' | 'server') {
	vi.resetModules();
	vi.doMock('web-haptics', () => {
		engine.loads += 1;
		return {
			WebHaptics: class {
				trigger(input: unknown) {
					engine.triggers.push(input);
				}
				cancel() {}
				destroy() {}
				setDebug() {}
			}
		};
	});
	vi.doMock('esm-env', async (importOriginal) => ({
		...(await importOriginal<typeof EsmEnv>()),
		BROWSER: condition === 'browser'
	}));
	const { UseHaptic } = await import('./use-haptic.svelte.ts');
	await vi.dynamicImportSettled();
	return UseHaptic;
}

beforeEach(() => {
	engine.loads = 0;
	engine.triggers.length = 0;
	vi.useFakeTimers();
	vi.stubGlobal('matchMedia', () => ({
		matches: false,
		addEventListener() {},
		removeEventListener() {}
	}));
	vi.stubGlobal('navigator', { vibrate: () => true });
});

afterEach(() => {
	vi.doUnmock('esm-env');
	vi.doUnmock('web-haptics');
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('UseHaptic under the browser condition', () => {
	it('clears isActive after the first trigger', async () => {
		const haptic = new (await loadUnder('browser'))();

		haptic.trigger(200);
		expect(haptic.isActive).toBe(true);
		expect(engine.loads).toBe(1);
		expect(engine.triggers).toEqual([200]);

		await vi.advanceTimersByTimeAsync(199);
		expect(haptic.isActive).toBe(true);
		await vi.advanceTimersByTimeAsync(1);
		expect(haptic.isActive).toBe(false);
	});

	it('clears isActive after the last of rapid repeat triggers', async () => {
		const haptic = new (await loadUnder('browser'))();

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
		const haptic = new (await loadUnder('browser'))();

		haptic.cancel();
		haptic.trigger(100);

		await vi.advanceTimersByTimeAsync(100);
		expect(haptic.isActive).toBe(false);
	});
});

describe('UseHaptic under the server condition', () => {
	it('loads no engine and ignores triggers', async () => {
		const haptic = new (await loadUnder('server'))();

		expect(haptic.isSupported).toBe(false);
		haptic.trigger(200);

		expect(haptic.isActive).toBe(false);
		expect(engine.loads).toBe(0);
		expect(engine.triggers).toEqual([]);
	});
});
