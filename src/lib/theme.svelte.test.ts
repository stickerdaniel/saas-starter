import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MODE_KEY = 'mode-watcher-mode';
const root = document.documentElement;

class SystemScheme extends EventTarget {
	readonly media = '(prefers-color-scheme: light)';
	constructor(public matches: boolean) {
		super();
	}
	change(matches: boolean) {
		this.matches = matches;
		this.dispatchEvent(Object.assign(new Event('change'), { matches }));
	}
}

let system: SystemScheme;
let windowListeners: Array<Parameters<typeof window.addEventListener>> = [];

async function loadTheme({ stored, systemLight }: { stored?: string; systemLight: boolean }) {
	if (stored !== undefined) localStorage.setItem(MODE_KEY, stored);
	system = new SystemScheme(systemLight);
	vi.stubGlobal('matchMedia', () => system);
	const addEventListener = window.addEventListener.bind(window);
	vi.spyOn(window, 'addEventListener').mockImplementation((...args) => {
		windowListeners.push(args);
		addEventListener(...args);
	});
	vi.resetModules();
	return import('./theme.svelte.ts');
}

const applied = () => ({
	dark: root.classList.contains('dark'),
	colorScheme: root.style.colorScheme
});

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

beforeEach(() => {
	localStorage.clear();
	root.className = '';
	root.removeAttribute('style');
});

afterEach(() => {
	for (const [type, listener, options] of windowListeners) {
		window.removeEventListener(type, listener, options);
	}
	windowListeners = [];
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.head.replaceChildren();
});

describe('theme', () => {
	it.each([
		{ stored: 'light', systemLight: false, scheme: 'light', storedAfter: 'light' },
		{ stored: 'dark', systemLight: true, scheme: 'dark', storedAfter: 'dark' },
		{ stored: 'system', systemLight: true, scheme: 'light', storedAfter: 'system' },
		{ stored: undefined, systemLight: false, scheme: 'dark', storedAfter: 'system' },
		{ stored: 'sepia', systemLight: true, scheme: 'light', storedAfter: 'system' },
		{ stored: '', systemLight: true, scheme: 'light', storedAfter: 'system' }
	] as const)(
		'starts on $scheme and stores $storedAfter for stored mode $stored with a light system $systemLight',
		async ({ stored, systemLight, scheme, storedAfter }) => {
			const { mode } = await loadTheme({ stored, systemLight });

			expect(mode.current).toBe(scheme);
			expect(applied()).toEqual({ dark: scheme === 'dark', colorScheme: scheme });
			expect(localStorage.getItem(MODE_KEY)).toBe(storedAfter);
		}
	);

	it('toggles synchronously, persists the mode and pauses transitions for one frame', async () => {
		const { mode, toggleMode } = await loadTheme({ stored: 'light', systemLight: true });

		toggleMode();
		expect(applied()).toEqual({ dark: true, colorScheme: 'dark' });
		expect(mode.current).toBe('dark');
		expect(localStorage.getItem(MODE_KEY)).toBe('dark');
		expect(document.head.querySelector('style')?.textContent).toContain('transition:none');

		await nextFrame();
		expect(document.head.querySelector('style')).toBeNull();

		toggleMode();
		expect(applied()).toEqual({ dark: false, colorScheme: 'light' });
		expect(localStorage.getItem(MODE_KEY)).toBe('light');
	});

	it('follows the system preference only in system mode', async () => {
		const { mode, toggleMode } = await loadTheme({ stored: 'system', systemLight: true });

		system.change(false);
		expect(applied()).toEqual({ dark: true, colorScheme: 'dark' });
		system.change(true);
		expect(mode.current).toBe('light');

		toggleMode();
		await nextFrame();
		system.change(false);
		system.change(true);
		expect(mode.current).toBe('dark');
		expect(document.head.querySelector('style')).toBeNull();
	});

	it('follows a mode another tab stores and ignores removals and other keys', async () => {
		const { mode } = await loadTheme({ stored: 'light', systemLight: true });
		const fromOtherTab = (init: StorageEventInit) =>
			window.dispatchEvent(new StorageEvent('storage', init));

		fromOtherTab({ key: MODE_KEY, newValue: 'dark' });
		expect(applied()).toEqual({ dark: true, colorScheme: 'dark' });

		fromOtherTab({ key: MODE_KEY, newValue: null });
		fromOtherTab({ key: null, newValue: null });
		fromOtherTab({ key: 'other', newValue: 'light' });
		expect(mode.current).toBe('dark');

		fromOtherTab({ key: MODE_KEY, newValue: 'system' });
		expect(mode.current).toBe('light');
	});

	it('starts on the system scheme when storage throws on every access', async () => {
		const blocked = () => {
			throw new DOMException('blocked', 'SecurityError');
		};
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const { mode } = await loadTheme({ systemLight: true });

		expect(mode.current).toBe('light');
		expect(applied()).toEqual({ dark: false, colorScheme: 'light' });
	});

	it('keeps the stored mode when storage refuses the write', async () => {
		const { mode, toggleMode } = await loadTheme({ stored: 'light', systemLight: false });
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('quota', 'QuotaExceededError');
		});

		expect(() => toggleMode()).not.toThrow();
		expect(mode.current).toBe('light');
		expect(applied()).toEqual({ dark: false, colorScheme: 'light' });
	});
});
