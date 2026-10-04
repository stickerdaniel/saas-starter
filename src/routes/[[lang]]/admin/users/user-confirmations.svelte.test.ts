import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { getFunctionName, type FunctionReference } from 'convex/server';
import en from '../../../../i18n/en.json';
import type { AdminUserData } from '$lib/convex/admin/types';
import type { ActionEvent } from './data-table-actions.svelte';
import type { PageData } from './$types';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@tolgee/svelte', async () => {
	const { translation } = await import('../support/test-fixtures/translation');
	const { default: T } = await import('../support/test-fixtures/translated-key.svelte');
	return { getTranslate: () => ({ t: translation }), T };
});
// The table renders only in the browser; these tests drive the row actions directly.
vi.mock('$app/environment', () => ({ browser: false, dev: true, building: false }));
vi.mock('$app/state', () => ({
	page: { data: {}, params: {}, url: new URL('http://localhost/en/admin/users') }
}));
vi.mock('$lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: () => {} } }));
vi.mock('../impersonate-user', () => ({ impersonateUser: vi.fn() }));

const mocks = vi.hoisted(() => ({
	mutation: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn() },
	onAction: undefined as ((event: ActionEvent) => void) | undefined
}));

vi.mock('convex-svelte', () => ({
	useConvexClient: () => ({ mutation: mocks.mutation, query: vi.fn() }),
	useQuery: () => ({ data: undefined, error: undefined, isLoading: false })
}));
vi.mock('svelte-sonner', () => ({ toast: mocks.toast }));
vi.mock('./user-actions-context', () => ({
	setUserActionHandler: (handler: (event: ActionEvent) => void) => {
		mocks.onAction = handler;
	},
	getUserActionHandler: () => mocks.onAction
}));
vi.mock('$lib/tables/convex/create-convex-cursor-table.svelte.ts', () => ({
	createConvexCursorTable: () => ({
		rows: [],
		currentUrlState: { search: '' },
		filters: { role: 'all', status: 'all', provider: 'all' },
		pageIndex: 0,
		pageSize: 10,
		pageCount: 1,
		totalCount: 0,
		hasLoadedCount: false,
		isUnfiltered: true,
		isLoading: false,
		error: null,
		sortBy: undefined,
		setSort: () => {},
		setFilter: () => {}
	})
}));

import { useDictionary } from '../support/test-fixtures/translation';
import UsersPage from './+page.svelte';

const target: AdminUserData = {
	id: 'user_target',
	email: 'target@example.com',
	role: 'user',
	banned: false,
	providers: ['credential']
};

let component: ReturnType<typeof mount> | undefined;

beforeEach(() => {
	useDictionary(en);
	mocks.mutation.mockReset();
	mocks.toast.error.mockReset();
	mocks.toast.success.mockReset();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	component = mount(UsersPage, {
		target: document.body,
		props: { data: { lang: 'en', oauthProviders: { google: false, github: false } } as PageData }
	});
	flushSync();
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

const confirmButton = () =>
	document.querySelector<HTMLButtonElement>('[data-testid="confirm-dialog-confirm"]');
const isOpen = () =>
	document.querySelector('[role="alertdialog"]')?.getAttribute('data-state') === 'open';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function mutationCall() {
	const [reference, args] = mocks.mutation.mock.calls[0] as [FunctionReference<'mutation'>, object];
	return [getFunctionName(reference), args];
}

describe('admin users confirmations', () => {
	it('keeps a failed ban open after its error toast', async () => {
		mocks.mutation.mockRejectedValue(new Error('backend down'));
		mocks.onAction!({ type: 'openBanDialog', user: target });
		flushSync();

		confirmButton()!.click();
		await settle();
		flushSync();

		expect(mutationCall()).toEqual([
			'admin/mutations:banUser',
			{ userId: 'user_target', reason: en.admin.users.ban_reason.default }
		]);
		expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringMatching(/^Failed to ban user: /));
		expect(isOpen()).toBe(true);
		expect(confirmButton()!.disabled).toBe(false);
	});

	it('changes the role chosen for that confirmation and closes', async () => {
		mocks.mutation.mockResolvedValue(null);
		mocks.onAction!({ type: 'openRoleDialog', user: target, role: 'admin' });
		flushSync();

		confirmButton()!.click();
		await settle();
		flushSync();

		expect(mutationCall()).toEqual([
			'admin/mutations:setUserRole',
			{ userId: 'user_target', role: 'admin' }
		]);
		expect(mocks.toast.success).toHaveBeenCalledWith('User role updated to admin');
		expect(isOpen()).toBe(false);
	});
});
