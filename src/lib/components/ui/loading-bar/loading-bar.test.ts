import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@tolgee/svelte', () => ({
	getTranslate: () => ({
		t: {
			subscribe: (callback: (translate: (key: string) => string) => void) => {
				callback(() => 'Loading');
				return () => {};
			}
		}
	})
}));

const motion = vi.hoisted(() => ({ animate: vi.fn(), reduced: { current: false } }));
vi.mock('motion-sv', () => ({
	useMotionValue: (initial: number) => {
		let value = initial;
		return { get: () => value, set: (next: number) => (value = next) };
	},
	useReducedMotion: () => motion.reduced,
	animate: motion.animate
}));

import LoadingBar from './loading-bar.svelte';
import LoadingBarTestFixture from './loading-bar-test-fixture.svelte';

motion.animate.mockImplementation(() => ({ stop: vi.fn() }));

let component: ReturnType<typeof mount> | undefined;

async function renderBar(props: Record<string, unknown>) {
	component = mount(LoadingBar, { target: document.body, props: props as never });
	await tick();
	return document.querySelector<HTMLElement>('[role="progressbar"]')!;
}

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	motion.animate.mockClear();
	motion.reduced.current = false;
});

describe('LoadingBar', () => {
	it('keeps accessible progress in sync with the bounded indicator', async () => {
		const root = await renderBar({ mode: 'progress', value: 150, max: 80 });
		expect(root.getAttribute('aria-valuenow')).toBe('80');
		expect(root.getAttribute('aria-valuemax')).toBe('80');
		expect(root.getAttribute('data-state')).toBe('loaded');
		const indicator = root.querySelector<HTMLElement>('[data-slot="progress-indicator"]');
		expect(indicator?.style.getPropertyValue('--indicator-width')).toBe('100%');
	});

	it('clamps negative values and invalid maximums', async () => {
		const root = await renderBar({ mode: 'progress', value: -5, max: 0 });
		expect(root.getAttribute('aria-valuenow')).toBe('0');
		expect(root.getAttribute('aria-valuemax')).toBe('1');
		expect(root.getAttribute('data-state')).toBe('loading');
		expect(
			root
				.querySelector<HTMLElement>('[data-slot="progress-indicator"]')
				?.style.getPropertyValue('--indicator-width')
		).toBe('0%');
	});

	it('preserves indeterminate progress when loading has a null value', async () => {
		const root = await renderBar({ mode: 'loading', value: null });
		expect(root.getAttribute('aria-valuenow')).toBeNull();
		expect(root.getAttribute('data-indeterminate')).toBe('');
		expect(root.getAttribute('data-state')).toBe('indeterminate');
		expect(
			root
				.querySelector<HTMLElement>('[data-slot="progress-indicator"]')
				?.style.getPropertyValue('--indicator-width')
		).toBe('0%');
	});

	it('measures a negative progress value from the supplied minimum', async () => {
		const root = await renderBar({ mode: 'progress', min: -20, max: 80, value: -5 });
		expect(root.getAttribute('aria-valuemin')).toBe('-20');
		expect(root.getAttribute('aria-valuenow')).toBe('-5');
		expect(root.getAttribute('aria-valuemax')).toBe('80');
		expect(
			root
				.querySelector<HTMLElement>('[data-slot="progress-indicator"]')
				?.style.getPropertyValue('--indicator-width')
		).toBe('15%');
	});

	it('normalizes an inverted range before forwarding it to Progress.Root', async () => {
		const root = await renderBar({ mode: 'progress', min: 20, max: 10, value: 30 });
		expect(root.getAttribute('aria-valuemin')).toBe('20');
		expect(root.getAttribute('aria-valuemax')).toBe('21');
		expect(root.getAttribute('aria-valuenow')).toBe('21');
		expect(root.getAttribute('data-state')).toBe('loaded');
		expect(
			root
				.querySelector<HTMLElement>('[data-slot="progress-indicator"]')
				?.style.getPropertyValue('--indicator-width')
		).toBe('100%');
	});

	it('does not animate a width already at its target', async () => {
		await renderBar({ mode: 'progress', value: 66 });
		expect(motion.animate).not.toHaveBeenCalled();
	});

	it('animates changed widths and switches modes and tones', async () => {
		component = mount(LoadingBarTestFixture, { target: document.body });
		await tick();
		const root = document.querySelector<HTMLElement>('[role="progressbar"]')!;
		const indicator = root.querySelector<HTMLElement>('[data-slot="progress-indicator"]')!;
		expect(indicator.className).toContain('bg-primary');
		expect(motion.animate).not.toHaveBeenCalled();

		const buttons = document.querySelectorAll('button');
		buttons[0]!.click();
		await tick();
		expect(motion.animate).not.toHaveBeenCalled();
		buttons[1]!.click();
		await tick();
		expect(root.getAttribute('aria-valuenow')).toBe('70');
		expect(motion.animate).toHaveBeenCalledWith(
			expect.anything(),
			70,
			expect.objectContaining({ type: 'spring' })
		);

		buttons[2]!.click();
		await tick();
		expect(motion.animate).toHaveBeenLastCalledWith(
			expect.anything(),
			100,
			expect.objectContaining({ type: 'tween' })
		);
		buttons[4]!.click();
		await tick();
		expect(indicator.className).toContain('bg-destructive');
		expect(indicator.classList.contains('transition')).toBe(true);
		buttons[3]!.click();
		await tick();
		expect(indicator.className).toContain('opacity-0');
		buttons[3]!.click();
		await tick();
		expect(indicator.className).toContain('opacity-100');
	});

	it('uses bounded width immediately under reduced motion', async () => {
		motion.reduced.current = true;
		const root = await renderBar({
			mode: 'progress',
			value: 160,
			max: 100,
			indicatorTone: 'muted'
		});
		expect(
			root
				.querySelector<HTMLElement>('[data-slot="progress-indicator"]')
				?.style.getPropertyValue('--indicator-width')
		).toBe('100%');
		expect(root.querySelector('[data-slot="progress-indicator"]')?.className).toContain(
			'bg-muted-foreground/45'
		);
		expect(motion.animate).not.toHaveBeenCalled();
	});
});
