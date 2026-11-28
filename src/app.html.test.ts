import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const MODE_KEY = 'mode-watcher-mode';
const RELOAD_EVENT = 'vite:preloadError';
const root = document.documentElement;

const applied = () => ({
	dark: root.classList.contains('dark'),
	colorScheme: root.style.colorScheme
});

const template = new DOMParser().parseFromString(
	readFileSync(join(import.meta.dirname, 'app.html'), 'utf8'),
	'text/html'
);
const headScript = (marker: string) =>
	[...template.querySelectorAll('script')]
		.map((script) => script.textContent)
		.find((body) => body.includes(marker));

const blocked = () => {
	throw new DOMException('blocked', 'SecurityError');
};

describe('app.html theme initializer', () => {
	const initializer = headScript(MODE_KEY);

	it('paints the system scheme when storage throws on every access', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
		vi.stubGlobal('matchMedia', () => ({ matches: true }));

		expect(() => new Function(initializer!)()).not.toThrow();
		expect(applied()).toEqual({ dark: false, colorScheme: 'light' });
	});
});

describe('app.html deploy reload', () => {
	const bootstrap = headScript(RELOAD_EVENT);

	function boot(storage: Pick<Storage, 'getItem' | 'setItem'>) {
		const listeners = new Map<string, () => void>();
		const reload = vi.fn();
		const window = {
			addEventListener: (type: string, listener: () => void) => listeners.set(type, listener)
		};
		new Function('window', 'location', 'sessionStorage', bootstrap!)(window, { reload }, storage);
		return { preloadError: () => listeners.get(RELOAD_EVENT)!(), reload };
	}

	it('reloads once while storage holds the marker', () => {
		const stored = new Map<string, string>();
		const { preloadError, reload } = boot({
			getItem: (key) => stored.get(key) ?? null,
			setItem: (key, value) => void stored.set(key, value)
		});

		preloadError();
		preloadError();

		expect(reload).toHaveBeenCalledOnce();
	});

	it('stays on the page when reading the marker throws', () => {
		const { preloadError, reload } = boot({ getItem: blocked, setItem: blocked });

		expect(preloadError).not.toThrow();
		expect(reload).not.toHaveBeenCalled();
	});

	it('stays on the page when storage refuses the marker', () => {
		const { preloadError, reload } = boot({ getItem: () => null, setItem: blocked });

		expect(preloadError).not.toThrow();
		expect(preloadError).not.toThrow();
		expect(reload).not.toHaveBeenCalled();
	});
});
