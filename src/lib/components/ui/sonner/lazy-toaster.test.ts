import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

vi.mock('svelte', async () =>
	(await import('../test-fixtures/svelte-client')).importSvelteClient()
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#lib/theme.svelte.ts', () => ({ mode: { current: 'light' } }));
vi.mock('@tolgee/svelte', async () => {
	const { readable } = await import('svelte/store');
	return { getTranslate: () => ({ t: readable((key: string) => key) }) };
});

import { toast } from 'svelte-sonner';
import LazyToaster from './lazy-toaster.svelte';

let hidden = false;
let component: ReturnType<typeof mount> | undefined;

beforeAll(() => import('./sonner.svelte'));

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal(
		'matchMedia',
		vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
	);
	vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
	component = mount(LazyToaster, { target: document.body });
	flushSync();
});

afterEach(async () => {
	toast.dismiss();
	flushSync();
	vi.advanceTimersByTime(1000);
	if (component) await unmount(component);
	component = undefined;
	hidden = false;
	vi.doUnmock('./sonner.svelte');
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	document.body.replaceChildren();
});

function holdRenderer() {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const chunk = { requests: 0, release };
	vi.doUnmock('./sonner.svelte');
	vi.doMock('./sonner.svelte', async (importOriginal) => {
		chunk.requests += 1;
		await gate;
		return importOriginal();
	});
	return chunk;
}

function toastsWith(message: string): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>('[data-sonner-toast]')].filter((node) =>
		node.textContent?.includes(message)
	);
}

async function settle(): Promise<void> {
	await vi.dynamicImportSettled();
	await tick();
	flushSync();
}

function setHidden(value: boolean) {
	hidden = value;
	document.dispatchEvent(new Event('visibilitychange'));
	flushSync();
}

describe('LazyToaster', () => {
	it('shows a toast raised before the renderer loads exactly once', async () => {
		const chunk = holdRenderer();
		toast('Saved');
		flushSync();
		await vi.waitFor(() => expect(chunk.requests).toBe(1));
		expect(toastsWith('Saved')).toHaveLength(0);

		chunk.release();
		await vi.waitFor(() => expect(toastsWith('Saved')).toHaveLength(1));
		await settle();
		expect(toastsWith('Saved')).toHaveLength(1);
		expect(document.querySelectorAll('[data-sonner-toaster]')).toHaveLength(1);
		expect(chunk.requests).toBe(1);
	});

	it('shows two toasts raised in a row', async () => {
		const chunk = holdRenderer();
		toast('First upload done');
		toast.error('Second upload failed');
		flushSync();
		chunk.release();

		await vi.waitFor(() => expect(toastsWith('Second upload failed')).toHaveLength(1));
		expect(toastsWith('First upload done')).toHaveLength(1);
	});

	it('keeps a toast while the tab is hidden', async () => {
		toast('Upload finished', { duration: 4000 });
		flushSync();
		await vi.waitFor(() => expect(toastsWith('Upload finished')).toHaveLength(1));

		setHidden(true);
		vi.advanceTimersByTime(60_000);
		flushSync();
		expect(toastsWith('Upload finished')).toHaveLength(1);

		setHidden(false);
		vi.advanceTimersByTime(5000);
		flushSync();
		expect(toastsWith('Upload finished')).toHaveLength(0);
	});

	it('shows a later toast after the renderer failed to load', async () => {
		let failures = 0;
		vi.doMock('./sonner.svelte', () => {
			failures += 1;
			throw new Error('Failed to fetch dynamically imported module');
		});
		toast('Lost');
		flushSync();
		await vi.waitFor(() => expect(failures).toBe(1));
		await settle();
		expect(toastsWith('Lost')).toHaveLength(0);

		vi.doUnmock('./sonner.svelte');
		toast('Checkout failed');
		flushSync();
		await vi.waitFor(() => expect(toastsWith('Checkout failed')).toHaveLength(1));
	});

	describe('when the renderer fails to load', () => {
		function failRenderer() {
			vi.doMock('./sonner.svelte', () => {
				throw new Error('Failed to fetch dynamically imported module');
			});
		}

		function fallbackWith(message: string): HTMLElement[] {
			return [...document.querySelectorAll<HTMLElement>('[data-testid="toast-fallback"]')].filter(
				(node) => node.textContent?.includes(message)
			);
		}

		it('shows the final text of a promise toast', async () => {
			failRenderer();
			let finish!: () => void;
			toast.promise(new Promise<void>((resolve) => (finish = resolve)), {
				loading: 'Saving recipients',
				success: 'Recipients saved'
			});
			flushSync();
			await settle();
			expect(fallbackWith('Saving recipients')).toHaveLength(1);

			finish();
			await vi.waitFor(() => expect(fallbackWith('Recipients saved')).toHaveLength(1));
			expect(fallbackWith('Saving recipients')).toHaveLength(0);
		});

		it('removes a toast when its time is up or the user closes it', async () => {
			failRenderer();
			toast('Checkout failed', { duration: 4000 });
			toast('Consent not saved', { duration: Number.POSITIVE_INFINITY });
			flushSync();
			await settle();
			expect(fallbackWith('Checkout failed')).toHaveLength(1);

			vi.advanceTimersByTime(4000);
			flushSync();
			expect(fallbackWith('Checkout failed')).toHaveLength(0);
			fallbackWith('Consent not saved')[0]
				?.querySelector<HTMLButtonElement>('button[aria-label="aria.close"]')
				?.click();
			flushSync();
			expect(fallbackWith('Consent not saved')).toHaveLength(0);
		});

		function closeButton(message: string): HTMLButtonElement | null | undefined {
			return fallbackWith(message)[0]?.querySelector<HTMLButtonElement>(
				'button[aria-label="aria.close"]'
			);
		}

		it('runs the close callbacks of an undo toast as the renderer does', async () => {
			failRenderer();
			const expired = { onAutoClose: vi.fn(), onDismiss: vi.fn() };
			const closed = { onAutoClose: vi.fn(), onDismiss: vi.fn() };
			const undone = { onAutoClose: vi.fn(), onDismiss: vi.fn() };
			const undo = vi.fn();
			toast('Passkey deleted', { duration: 5000, ...expired });
			toast('Second passkey deleted', { duration: 5000, ...closed });
			toast('Third passkey deleted', {
				duration: 5000,
				action: { label: 'Undo', onClick: undo },
				...undone
			});
			flushSync();
			await settle();

			vi.advanceTimersByTime(1000);
			closeButton('Second passkey deleted')?.click();
			flushSync();
			expect(closed.onDismiss).toHaveBeenCalledOnce();

			[...(fallbackWith('Third passkey deleted')[0]?.querySelectorAll('button') ?? [])]
				.find((button) => button.textContent?.trim() === 'Undo')
				?.click();
			flushSync();
			expect(undo).toHaveBeenCalledOnce();
			expect(fallbackWith('Third passkey deleted')).toHaveLength(0);

			vi.advanceTimersByTime(10_000);
			flushSync();
			expect(expired.onAutoClose).toHaveBeenCalledOnce();
			expect(expired.onDismiss).not.toHaveBeenCalled();
			expect(closed.onAutoClose).not.toHaveBeenCalled();
			expect(undone.onAutoClose).not.toHaveBeenCalled();
			expect(undone.onDismiss).not.toHaveBeenCalled();
		});

		it('pauses every toast while the tab is hidden or the pointer is on the list', async () => {
			failRenderer();
			setHidden(true);
			toast('Upload finished', { duration: 4000 });
			flushSync();
			await settle();
			vi.advanceTimersByTime(60_000);
			flushSync();
			expect(fallbackWith('Upload finished')).toHaveLength(1);

			setHidden(false);
			toast('Passkey deleted', { duration: 4000 });
			flushSync();
			vi.advanceTimersByTime(1000);
			const list = document.querySelector('[data-testid="toast-fallback"]')?.parentElement;
			list?.dispatchEvent(new PointerEvent('pointerenter'));
			vi.advanceTimersByTime(60_000);
			setHidden(true);
			list?.dispatchEvent(new PointerEvent('pointerleave'));
			vi.advanceTimersByTime(60_000);
			setHidden(false);
			flushSync();
			expect(fallbackWith('Upload finished')).toHaveLength(1);
			expect(fallbackWith('Passkey deleted')).toHaveLength(1);

			vi.advanceTimersByTime(2999);
			flushSync();
			expect(fallbackWith('Passkey deleted')).toHaveLength(1);
			vi.advanceTimersByTime(1);
			flushSync();
			expect(fallbackWith('Upload finished')).toHaveLength(0);
			expect(fallbackWith('Passkey deleted')).toHaveLength(0);
		});

		it('offers no close button while a toast is loading', async () => {
			failRenderer();
			toast.loading('Saving recipients');
			toast('Required notice', { dismissible: false });
			flushSync();
			await settle();

			expect(fallbackWith('Saving recipients')).toHaveLength(1);
			expect(closeButton('Saving recipients')).toBeNull();
			expect(closeButton('Required notice')).toBeNull();
		});
	});
});
