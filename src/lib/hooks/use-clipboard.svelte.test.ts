import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UseClipboard } from './use-clipboard.svelte.ts';

const DELAY = 500;

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('UseClipboard', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	describe('secure clipboard', () => {
		const writeText = vi.fn<(text: string) => Promise<void>>();

		beforeEach(() => {
			writeText.mockReset().mockResolvedValue(undefined);
			vi.stubGlobal('isSecureContext', true);
			vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
		});

		it('returns to idle after the delay', async () => {
			const clipboard = new UseClipboard({ delay: DELAY });

			await expect(clipboard.copy('a')).resolves.toBe('success');
			expect(writeText).toHaveBeenCalledWith('a');
			expect(clipboard.copied).toBe(true);

			await vi.advanceTimersByTimeAsync(DELAY);
			expect(clipboard.status).toBeUndefined();
		});

		it('returns to idle after rapid repeat copies', async () => {
			const clipboard = new UseClipboard({ delay: DELAY });

			await clipboard.copy('a');
			await vi.advanceTimersByTimeAsync(DELAY / 2);
			await clipboard.copy('b');
			await clipboard.copy('c');
			expect(clipboard.status).toBe('success');

			await vi.advanceTimersByTimeAsync(DELAY - 1);
			expect(clipboard.status).toBe('success');
			await vi.advanceTimersByTimeAsync(1);
			expect(clipboard.status).toBeUndefined();
		});

		it('keeps the latest result when an earlier copy settles late', async () => {
			const slow = deferred<void>();
			writeText.mockReturnValueOnce(slow.promise);
			vi.spyOn(console, 'error').mockImplementation(() => {});
			const clipboard = new UseClipboard({ delay: DELAY });

			const first = clipboard.copy('a');
			await expect(clipboard.copy('b')).resolves.toBe('success');

			slow.reject(new Error('denied'));
			await expect(first).resolves.toBe('failure');
			expect(clipboard.status).toBe('success');

			await vi.advanceTimersByTimeAsync(DELAY);
			expect(clipboard.status).toBeUndefined();
		});
	});

	describe('execCommand fallback', () => {
		const execCommand = vi.fn<(command: string) => boolean>();

		beforeEach(() => {
			execCommand.mockReset().mockReturnValue(true);
			vi.stubGlobal('isSecureContext', false);
			Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
		});

		it('returns to idle after the delay', async () => {
			const clipboard = new UseClipboard({ delay: DELAY });

			await expect(clipboard.copy('a')).resolves.toBe('success');
			expect(execCommand).toHaveBeenCalledWith('copy');
			expect(document.querySelector('textarea')).toBeNull();

			await vi.advanceTimersByTimeAsync(DELAY);
			expect(clipboard.status).toBeUndefined();
		});

		it('returns to idle after rapid repeat copies', async () => {
			const clipboard = new UseClipboard({ delay: DELAY });

			await clipboard.copy('a');
			execCommand.mockReturnValue(false);
			await clipboard.copy('b');
			expect(clipboard.status).toBe('failure');

			await vi.advanceTimersByTimeAsync(DELAY);
			expect(clipboard.status).toBeUndefined();
		});
	});
});
