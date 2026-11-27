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

	describe('a text that still loads', () => {
		class Item {
			parts: Record<string, Promise<Blob>>;
			constructor(parts: Record<string, Promise<Blob>>) {
				this.parts = parts;
			}
		}
		const write = vi.fn<(items: Item[]) => Promise<void>>();

		beforeEach(() => {
			write.mockReset().mockImplementation(async ([item]) => {
				await item!.parts['text/plain'];
			});
			vi.stubGlobal('isSecureContext', true);
			vi.stubGlobal('ClipboardItem', Item);
			vi.stubGlobal('navigator', { ...navigator, clipboard: { write } });
		});

		it('starts the write before the text arrives', async () => {
			const text = deferred<string>();
			const clipboard = new UseClipboard({ delay: DELAY });

			const copied = clipboard.copy(text.promise);
			expect(write).toHaveBeenCalledTimes(1);

			text.resolve('# Page');
			await expect(copied).resolves.toBe('success');
			const [item] = write.mock.calls[0]![0];
			await expect((await item!.parts['text/plain']!).text()).resolves.toBe('# Page');
		});

		it('fails when the text does not arrive', async () => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			const text = deferred<string>();
			const clipboard = new UseClipboard({ delay: DELAY });

			const copied = clipboard.copy(text.promise);
			text.reject(new Error('HTTP 404'));
			await expect(copied).resolves.toBe('failure');
			expect(clipboard.copied).toBe(false);
		});

		it('writes the arrived text where the clipboard has no write', async () => {
			const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
			vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
			const clipboard = new UseClipboard({ delay: DELAY });

			await expect(clipboard.copy(Promise.resolve('# Page'))).resolves.toBe('success');
			expect(writeText).toHaveBeenCalledWith('# Page');
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
