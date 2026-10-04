import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { getFunctionName, type FunctionReference } from 'convex/server';
import en from '../../../../i18n/en.json';
import de from '../../../../i18n/de.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@tolgee/svelte', async () => {
	const { translation } = await import('./test-fixtures/translation');
	const { default: T } = await import('./test-fixtures/translated-key.svelte');
	return { getTranslate: () => ({ t: translation }), T };
});
vi.mock('$app/state', () => ({
	page: { data: { lang: 'de' }, params: {}, url: new URL('http://localhost/de/admin/support') }
}));
vi.mock('../impersonate-user', () => ({
	canImpersonateUser: () => false,
	impersonateUser: vi.fn()
}));

const supportMetadata = vi.hoisted(() => ({
	current: {} as { status: 'open' | 'done'; priority?: 'low' | 'medium' | 'high' }
}));

vi.mock('convex-svelte', () => ({
	useConvexClient: () => ({ mutation: vi.fn() }),
	useQuery: (query: FunctionReference<'query'>) => ({
		data:
			getFunctionName(query) === 'admin/support/queries:getThreadForAdmin'
				? {
						threadId: 'thread_1',
						supportMetadata: {
							...supportMetadata.current,
							notificationEmail: 'customer@example.com'
						}
					}
				: undefined,
		error: undefined,
		isLoading: false
	})
}));

import { useDictionary } from './test-fixtures/translation';
import ThreadDetails from './thread-details.svelte';

let component: ReturnType<typeof mount> | undefined;

function renderDetails(metadata: typeof supportMetadata.current) {
	supportMetadata.current = metadata;
	component = mount(ThreadDetails, { target: document.body, props: { threadId: 'thread_1' } });
	flushSync();
}

const triggers = () =>
	[...document.querySelectorAll('[data-slot="select-trigger"]')].map((trigger) =>
		trigger.textContent?.trim()
	);

beforeEach(() => {
	useDictionary(de);
});

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

describe('ThreadDetails', () => {
	it('shows the selected status and priority in the reader’s language', () => {
		renderDetails({ status: 'done', priority: 'medium' });

		expect(triggers()).toEqual(
			expect.arrayContaining([de.admin.support.status.done, de.admin.support.priority.medium])
		);
	});

	it('names a missing priority in the reader’s language', () => {
		renderDetails({ status: 'open' });

		expect(triggers()).toEqual(
			expect.arrayContaining([de.admin.support.status.open, de.admin.support.priority.none])
		);
	});

	it('prefills the reply mail in the reader’s language', () => {
		useDictionary(en);
		renderDetails({ status: 'open' });

		const link = document.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
		const href = new URL(link!.href);
		expect(href.pathname).toBe('customer@example.com');
		expect(href.searchParams.get('subject')).toBe(en.admin.support.email.reply_subject);
		expect(href.searchParams.get('body')).toBe(
			en.admin.support.email.reply_body.replace(/\n/g, '\r\n')
		);
	});
});
