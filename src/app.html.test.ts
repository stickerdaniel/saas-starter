import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const MODE_KEY = 'mode-watcher-mode';
const root = document.documentElement;

const applied = () => ({
	dark: root.classList.contains('dark'),
	colorScheme: root.style.colorScheme
});

describe('app.html theme initializer', () => {
	const template = new DOMParser().parseFromString(
		readFileSync(join(import.meta.dirname, 'app.html'), 'utf8'),
		'text/html'
	);
	const initializer = [...template.querySelectorAll('script')]
		.map((script) => script.textContent)
		.find((body) => body.includes(MODE_KEY));

	it('paints the system scheme when storage throws on every access', () => {
		const blocked = () => {
			throw new DOMException('blocked', 'SecurityError');
		};
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
		vi.stubGlobal('matchMedia', () => ({ matches: true }));

		expect(() => new Function(initializer!)()).not.toThrow();
		expect(applied()).toEqual({ dark: false, colorScheme: 'light' });
	});
});
