import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../node_modules/svelte/src/index-client.js')
);

const mocks = vi.hoisted(() => ({
	page: { url: new URL('https://example.com/de') },
	goto: vi.fn(),
	onChange: undefined as ((code: string) => Promise<void>) | undefined
}));

vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('#lib/utils/i18n.js', () => ({ useLanguage: () => 'de' }));
vi.mock('#lib/auth-client.js', () => ({ updateUserWithLocale: vi.fn() }));
vi.mock('#lib/i18n/load-translations.js', () => ({ preloadTranslations: vi.fn() }));
vi.mock('@mmailaender/convex-better-auth-svelte/svelte', () => ({
	useAuth: () => ({ isAuthenticated: false, isLoading: false })
}));
// The menu is bits-ui's concern; keep the choice it reports.
vi.mock('#lib/components/ui/language-switcher/index.js', () => ({
	LanguageSwitcher: (_anchor: unknown, props: { onChange: (code: string) => Promise<void> }) => {
		mocks.onChange = props.onChange;
	}
}));

import LanguageSwitcher from './LanguageSwitcher.svelte';

let component: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	mocks.goto.mockReset();
});

describe('LanguageSwitcher', () => {
	// A query holds free text, which can look like route syntax.
	it.each(['?q=[draft]', '?q=https://x.io'])(
		'keeps the query %s when switching',
		async (search) => {
			mocks.page.url = new URL(`https://example.com/de/app/settings${search}`);
			component = mount(LanguageSwitcher, { target: document.body });
			flushSync();

			await mocks.onChange!('en');

			expect(mocks.goto).toHaveBeenCalledWith(`/en/app/settings${search}`);
		}
	);
});
