import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

const mocks = vi.hoisted(() => ({
	page: { url: new URL('https://example.com/de') },
	goto: vi.fn()
}));

vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('#lib/utils/i18n.js', () => ({ useLanguage: () => 'de' }));
vi.mock('#lib/auth-client.js', () => ({ updateUserWithLocale: vi.fn() }));
vi.mock('#lib/i18n/load-translations.js', () => ({ preloadTranslations: vi.fn() }));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('@mmailaender/convex-better-auth-svelte/svelte', () => ({
	useAuth: () => ({ isAuthenticated: false, isLoading: false })
}));
vi.mock('@tolgee/svelte', async () => {
	const { readable } = await import('svelte/store');
	return { getTranslate: () => ({ t: readable((key: string) => key) }) };
});

import LanguageSwitcher from './LanguageSwitcher.svelte';

let component: ReturnType<typeof mount> | undefined;

// Transforming the menu and Bits UI takes longer than a waitFor under a full
// run. Holding the chunk later still goes through the mock.
beforeAll(() => import('./ui/language-switcher/language-switcher.svelte'));

beforeEach(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
	component = mount(LanguageSwitcher, { target: document.body });
	flushSync();
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.doUnmock('./ui/language-switcher/language-switcher.svelte');
	vi.unstubAllGlobals();
	mocks.goto.mockReset();
});

function trigger(): HTMLElement {
	return document.querySelector<HTMLElement>('[aria-haspopup="menu"]')!;
}

function menu(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[role="menu"]');
}

/** Holds the menu's chunk until the test releases it. */
function holdMenuChunk() {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const chunk = { requested: false, release };
	vi.doUnmock('./ui/language-switcher/language-switcher.svelte');
	vi.doMock('./ui/language-switcher/language-switcher.svelte', async (importOriginal) => {
		chunk.requested = true;
		await gate;
		return importOriginal();
	});
	return chunk;
}

async function settle(): Promise<void> {
	await vi.dynamicImportSettled();
	await tick();
}

describe('LanguageSwitcher', () => {
	it('opens on a click without a pointer that arrives before the menu loads', async () => {
		const chunk = holdMenuChunk();

		trigger().dispatchEvent(
			new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })
		);
		await vi.waitFor(() => expect(chunk.requested).toBe(true));
		expect(menu()).toBeNull();

		chunk.release();
		await vi.waitFor(() => expect(menu()).not.toBeNull());
		await settle();
		expect(trigger().getAttribute('aria-expanded')).toBe('true');
		expect(menu()!.querySelectorAll('[role="menuitemradio"]').length).toBeGreaterThan(0);
	});

	it('leaves a pointer click to the press that started it', async () => {
		const chunk = holdMenuChunk();

		trigger().dispatchEvent(
			new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
		);
		await settle();
		expect(chunk.requested).toBe(false);

		trigger().dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' })
		);
		trigger().dispatchEvent(
			new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
		);
		chunk.release();
		await vi.waitFor(() => expect(menu()).not.toBeNull());
		await settle();
		expect(trigger().getAttribute('aria-expanded')).toBe('true');
	});

	// A query holds free text, which can look like route syntax.
	it.each(['?q=[draft]', '?q=https://x.io'])(
		'keeps the query %s when switching',
		async (search) => {
			mocks.page.url = new URL(`https://example.com/de/app/settings${search}`);
			trigger().dispatchEvent(
				new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })
			);
			const english = await vi.waitFor(() => {
				const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
					(node) => node.textContent?.trim() === 'English'
				);
				expect(item).toBeDefined();
				return item!;
			});

			english.click();

			await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledWith(`/en/app/settings${search}`));
		}
	);
});
