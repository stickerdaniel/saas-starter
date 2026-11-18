import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import en from '../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('@tolgee/svelte', async () => {
	const { translation } =
		await import('../../../routes/[[lang]]/admin/support/test-fixtures/translation');
	return { getTranslate: () => ({ t: translation }) };
});
vi.mock('$app/state', () => ({ page: { data: { lang: 'en' } } }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));

import { useDictionary } from '../../../routes/[[lang]]/admin/support/test-fixtures/translation';
import SidebarThreadList from './sidebar-thread-list.svelte';

const threads = Array.from({ length: 12 }, (_, index) => ({
	id: `thread-${index}`,
	label: `Thread ${index}`,
	url: `/en/app/ai-chat?thread=thread-${index}`
}));

let component: ReturnType<typeof mount> | undefined;

function renderList(hasMore: boolean) {
	const onShowMore = vi.fn();
	component = mount(SidebarThreadList, {
		target: document.body,
		props: { items: threads, hasMore, onShowMore }
	});
	flushSync();
	const links = [...document.querySelectorAll('a')].map((link) => link.textContent?.trim());
	const showMore = [...document.querySelectorAll('button')].find(
		(button) => button.textContent?.trim() === 'Show more'
	);
	return { links, showMore, onShowMore };
}

beforeEach(() => {
	useDictionary(en);
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

// The owning query pages threads on the server, so the list renders every loaded
// thread and offers more only when the backend reports another page.
describe('sidebar thread list', () => {
	it('renders every loaded thread and requests the next page from Show more', () => {
		const { links, showMore, onShowMore } = renderList(true);

		expect(links).toEqual(threads.map((thread) => thread.label));
		showMore!.click();
		expect(onShowMore).toHaveBeenCalledOnce();
	});

	it('offers no Show more when the backend has no further page', () => {
		const { links, showMore } = renderList(false);

		expect(links).toHaveLength(threads.length);
		expect(showMore).toBeUndefined();
	});
});
