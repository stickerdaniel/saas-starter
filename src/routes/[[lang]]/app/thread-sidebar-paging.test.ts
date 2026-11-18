/**
 * The mounted app layout, paging the AI chat threads its sidebar lists.
 *
 * The thread query and the authenticated shell are replaced; the layout's own
 * paging and the sidebar configuration it builds from the result run for real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$app/state', () => ({
	page: { url: new URL('https://example.com/en/app'), params: { lang: 'en' } }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('@tolgee/svelte', async () => {
	const { readable } = await import('svelte/store');
	return { getTranslate: () => ({ t: readable((key: string) => key) }) };
});
vi.mock('convex-svelte', () => import('./test-fixtures/thread-list-server.svelte.ts'));
vi.mock('#lib/components/authenticated/index.js', async () => ({
	AuthenticatedLayout: (await import('./test-fixtures/CapturedAuthenticatedLayout.svelte')).default,
	getAppSidebarConfig: (await import('#lib/components/authenticated/configs/app-sidebar-config.js'))
		.getAppSidebarConfig
}));
vi.mock(
	'#lib/components/customer-support/support-ticket-migration-bootstrap.svelte',
	() => import('#lib/components/test-fixtures/Passthrough.svelte')
);

import { shellProps } from './test-fixtures/CapturedAuthenticatedLayout.svelte';
import { threadServer, type ThreadPage } from './test-fixtures/thread-list-server.svelte.ts';
import AppLayout from './+layout.svelte';

let component: ReturnType<typeof mount> | undefined;

function page(count: number, hasMore: boolean): ThreadPage {
	return {
		threads: Array.from({ length: count }, (_, index) => ({
			_id: `thread-${index + 1}`,
			title: `Thread ${index + 1}`,
			lastMessageAt: 1_000 - index
		})),
		hasMore
	};
}

/** The thread ids the sidebar currently lists. */
function sidebarThreads(): string[] {
	return (shellProps().threadSubItems ?? []).map((item) => item.id);
}

function showMore(): void {
	shellProps().onLoadMoreThreads!();
	flushSync();
}

beforeEach(() => {
	threadServer.reset();
	component = mount(AppLayout, {
		target: document.body,
		props: {
			data: { viewer: null, sidebarOpen: true }
		} as unknown as Svelte.ComponentProps<typeof AppLayout>
	});
	flushSync();
	threadServer.deliver(10, page(10, true));
	flushSync();
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

describe('AI chat sidebar paging', () => {
	it('asks for 10 threads first and 5 more on each show more', () => {
		expect(threadServer.requests).toEqual([10]);
		expect(shellProps().threadsHasMore).toBe(true);
		showMore();
		expect(threadServer.requests).toEqual([10, 15]);
		threadServer.deliver(15, page(15, true));
		flushSync();
		showMore();
		expect(threadServer.requests).toEqual([10, 15, 20]);
	});

	it('keeps listing the loaded threads until the larger page arrives', () => {
		const firstPage = page(10, true).threads.map((thread) => thread._id);
		expect(sidebarThreads()).toEqual(firstPage);

		showMore();
		expect(sidebarThreads()).toEqual(firstPage);

		threadServer.deliver(15, page(12, false));
		flushSync();
		expect(sidebarThreads()).toEqual(page(12, false).threads.map((thread) => thread._id));
		expect(shellProps().threadsHasMore).toBe(false);
	});
});
