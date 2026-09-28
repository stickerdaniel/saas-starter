import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('svelte/motion', () => ({
	prefersReducedMotion: {
		get current() {
			return preference.reduced;
		}
	}
}));
vi.mock('$lib/hooks/use-media.svelte.ts', () => ({
	TAILWIND_BREAKPOINTS: { lg: '64rem' },
	useMedia: () => ({
		get lg() {
			return preference.desktop;
		}
	})
}));
vi.mock('$lib/components/ui/FollowingPointer/FollowingPointer.svelte', async () => ({
	default: (await import('./test-fixtures/RiveContent.svelte')).default
}));

const runtime = vi.hoisted(() => ({
	instances: [] as Array<{
		cleanup: ReturnType<typeof vi.fn>;
		resizeDrawingSurfaceToCanvas: ReturnType<typeof vi.fn>;
	}>,
	create: vi.fn(function (options: { autoplay?: boolean; onLoad?: () => void }) {
		const instance = { cleanup: vi.fn(), resizeDrawingSurfaceToCanvas: vi.fn() };
		runtime.instances.push(instance);
		queueMicrotask(() => options.onLoad?.());
		return instance;
	})
}));
vi.mock('@rive-app/canvas', () => ({ Rive: runtime.create }));

import RiveBackground from './RiveBackground.svelte';

let preference = $state({ reduced: false, desktop: true });
let component: ReturnType<typeof mount> | undefined;
let fetchFile: ReturnType<typeof vi.fn>;

function render(props: { defer?: boolean; desktopOnly?: boolean } = {}) {
	component = mount(RiveBackground, {
		target: document.body,
		props: { src: '/animation.riv', ...props }
	});
	flushSync();
}

async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 20));
	flushSync();
}

beforeEach(() => {
	preference = { reduced: false, desktop: true };
	runtime.instances.length = 0;
	runtime.create.mockClear();
	fetchFile = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
	vi.stubGlobal('fetch', fetchFile);
	vi.stubGlobal('matchMedia', () => ({
		get matches() {
			return preference.desktop;
		}
	}));
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

describe('decorative Rive motion', () => {
	it('does not load or play the animation when reduced motion is already requested', async () => {
		preference.reduced = true;
		render();
		await settle();
		expect(fetchFile).not.toHaveBeenCalled();
		expect(runtime.create).not.toHaveBeenCalled();
	});

	it('stops on preference changes and resumes only after motion is allowed again', async () => {
		render();
		await vi.waitFor(() => expect(runtime.create).toHaveBeenCalledTimes(1));
		expect(runtime.create.mock.calls[0]![0].autoplay).toBe(true);
		preference.reduced = true;
		flushSync();
		expect(runtime.instances[0]!.cleanup).toHaveBeenCalledTimes(1);
		preference.reduced = false;
		flushSync();
		await vi.waitFor(() => expect(runtime.create).toHaveBeenCalledTimes(2));
		expect(fetchFile).toHaveBeenCalledTimes(1);
		await unmount(component!);
		component = undefined;
		expect(runtime.instances[1]!.cleanup).toHaveBeenCalledTimes(1);
	});

	it('cancels a pending download and ignores its late result', async () => {
		let finish!: (response: Response) => void;
		fetchFile.mockImplementation(
			() =>
				new Promise<Response>((resolve) => {
					finish = resolve;
				})
		);
		render();
		await vi.waitFor(() => expect(fetchFile).toHaveBeenCalledTimes(1));
		const signal = fetchFile.mock.calls[0]![1].signal as AbortSignal;
		preference.reduced = true;
		flushSync();
		expect(signal.aborted).toBe(true);
		finish(new Response(new Uint8Array([1, 2, 3])));
		await settle();
		expect(runtime.create).not.toHaveBeenCalled();
	});

	it('cancels deferred initialization when the preference changes', async () => {
		let start!: IdleRequestCallback;
		const cancel = vi.fn();
		vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
			start = callback;
			return 7;
		});
		vi.stubGlobal('cancelIdleCallback', cancel);
		render({ defer: true });
		preference.reduced = true;
		flushSync();
		expect(cancel).toHaveBeenCalledWith(7);
		start({ didTimeout: false, timeRemaining: () => 50 });
		await settle();
		expect(runtime.create).not.toHaveBeenCalled();
	});

	it('keeps desktop-only animation disabled on a small viewport', async () => {
		preference.desktop = false;
		render({ desktopOnly: true });
		await settle();
		expect(runtime.create).not.toHaveBeenCalled();
		preference.desktop = true;
		flushSync();
		await vi.waitFor(() => expect(runtime.create).toHaveBeenCalledTimes(1));
		preference.desktop = false;
		flushSync();
		expect(runtime.instances[0]!.cleanup).toHaveBeenCalledTimes(1);
	});
});
