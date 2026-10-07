import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import PasswordHarness from './test-fixtures/PasswordHarness.svelte';

// Mount with the real client runtime; Vitest otherwise resolves Svelte's server entry.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

const loading = vi.hoisted(() => ({
	requested: [] as string[],
	gate: undefined as Promise<void> | undefined
}));

const idleTasks = new Map<number, IdleRequestCallback>();
let nextIdleId = 0;
vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
	const id = ++nextIdleId;
	idleTasks.set(id, callback);
	return id;
});
vi.stubGlobal('cancelIdleCallback', (id: number) => idleTasks.delete(id));

function runIdleTasks() {
	for (const [id, callback] of idleTasks) {
		idleTasks.delete(id);
		callback({ didTimeout: false, timeRemaining: () => 50 });
	}
}

// Observe module loading and delay one dictionary, while retaining the real scorer and data.
vi.mock('@zxcvbn-ts/core', async (importOriginal) => {
	loading.requested.push('core');
	return importOriginal();
});
vi.mock('@zxcvbn-ts/language-common', async (importOriginal) => {
	loading.requested.push('common');
	return importOriginal();
});
vi.mock('@zxcvbn-ts/language-en', async (importOriginal) => {
	loading.requested.push('en');
	await loading.gate;
	return importOriginal();
});

let harness: ReturnType<typeof mount> | undefined;
let releaseDictionaries: (() => void) | undefined;

afterEach(async () => {
	releaseDictionaries?.();
	if (harness) await unmount(harness);
	harness = undefined;
	document.body.replaceChildren();
	idleTasks.clear();
	vi.restoreAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

async function render(props: { withStrength?: boolean; invalid?: boolean } = {}) {
	if (harness) await unmount(harness);
	harness = mount(PasswordHarness, { target: document.body, props });
	await tick();
	return document.querySelector('input')!;
}

async function type(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
}

function score() {
	return Number(document.querySelector('[role="meter"]')!.getAttribute('aria-valuenow'));
}

describe('password strength loading', () => {
	it('warms scoring after page load without input and preserves validation while loading', async () => {
		const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
		let input = await render();
		input.focus();
		await type(input, 'password');
		runIdleTasks();
		await vi.dynamicImportSettled();

		expect(loading.requested, 'Only a mounted strength meter should load zxcvbn').toEqual([]);
		expect(input.checkValidity()).toBe(true);
		expect(input.validationMessage).toBe('');
		expect(input.getAttribute('aria-invalid')).toBeNull();

		await render({ withStrength: true });
		await vi.dynamicImportSettled();
		expect(loading.requested, 'Scoring must leave the initial page load free to render').toEqual(
			[]
		);

		await unmount(harness!);
		harness = undefined;
		readyState.mockReturnValue('complete');
		window.dispatchEvent(new Event('load'));
		await new Promise((resolve) => setTimeout(resolve, 1100));
		runIdleTasks();
		await vi.dynamicImportSettled();
		expect(loading.requested, 'Leaving the page must cancel its background download').toEqual([]);

		input = await render({ withStrength: true });
		await vi.dynamicImportSettled();
		expect(loading.requested, 'Background scoring must yield before starting').toEqual([]);
		loading.gate = new Promise<void>((resolve) => (releaseDictionaries = resolve));
		await vi.waitFor(
			() => {
				runIdleTasks();
				expect(loading.requested.toSorted()).toEqual(['common', 'core', 'en']);
			},
			{ timeout: 3000 }
		);
		expect(input.value).toBe('');
		expect(document.activeElement).not.toBe(input);

		input.focus();
		await type(input, 'password');
		await type(input, 'meadow-L7!orbit-9Cobalt');
		expect(score()).toBe(0);
		expect(input.validity.customError).toBe(true);

		releaseDictionaries!();
		await vi.dynamicImportSettled();
		await vi.waitFor(async () => {
			await tick();
			expect(score()).toBe(4);
		});

		expect(input.checkValidity()).toBe(true);
		expect(input.getAttribute('aria-invalid')).toBeNull();

		input = await render({ withStrength: true });
		for (const [value, expectedScore] of [
			['password', 0],
			['Password123!', 1],
			['weakpass1', 2],
			['TestPassword123!', 3],
			['meadow-L7!orbit-9Cobalt', 4]
		] as const) {
			await type(input, value);
			expect(score()).toBe(expectedScore);
			expect(input.checkValidity()).toBe(expectedScore >= 3);
			expect(input.validationMessage).toBe(expectedScore < 3 ? 'Choose a stronger password' : '');
			expect(input.getAttribute('aria-invalid')).toBe(expectedScore < 3 ? 'true' : null);
		}

		await type(input, '');
		expect(input.validity.customError).toBe(false);
		expect(input.validity.valueMissing).toBe(true);
		expect(input.checkValidity()).toBe(false);
		expect(loading.requested.toSorted()).toEqual(['common', 'core', 'en']);
	});

	it('preserves external validation errors on a plain input', async () => {
		const input = await render({ invalid: true });
		await type(input, 'meadow-L7!orbit-9Cobalt');

		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(input.validity.customError).toBe(false);
	});
});
