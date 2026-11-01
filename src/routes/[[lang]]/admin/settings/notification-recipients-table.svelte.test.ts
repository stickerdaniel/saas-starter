import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type * as SvelteReactivity from 'svelte/reactivity';
import { getFunctionName, type FunctionReference } from 'convex/server';
import type { NotificationRecipient } from '#lib/convex/admin/notificationPreferences/queries.js';
import en from '../../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
// The server entry's SvelteMap is a plain Map; the pending overlay needs the reactive one.
vi.mock('svelte/reactivity', () =>
	vi.importActual<typeof SvelteReactivity>(
		'../../../../../node_modules/svelte/src/reactivity/index-client.js'
	)
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@tolgee/svelte', async () => {
	const { translation } = await import('../support/test-fixtures/translation');
	const { default: T } = await import('../support/test-fixtures/translated-key.svelte');
	return { getTranslate: () => ({ t: translation }), T };
});
// jsdom has no matchMedia; the row actions' confirm dialog reads reduced motion on import.
vi.hoisted(() => {
	Object.defineProperty(window, 'matchMedia', {
		configurable: true,
		value: (media: string) => ({
			matches: false,
			media,
			addEventListener() {},
			removeEventListener() {}
		})
	});
});
vi.mock('$app/env', () => ({ browser: true, dev: true, building: false }));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: () => {} } }));
// The dialog posts through a remote form, which needs a SvelteKit server.
vi.mock('./add-email-dialog.svelte', () => ({ default: () => {} }));

const mocks = vi.hoisted(() => ({
	mutation: vi.fn(),
	rows: [] as NotificationRecipient[]
}));

vi.mock('convex-svelte', () => ({
	useConvexClient: () => ({ mutation: mocks.mutation, query: vi.fn() })
}));
// The toggle reports through a toast; a rejected update is expected here.
vi.mock('svelte-sonner', () => ({
	toast: { promise: (update: Promise<unknown>) => void update.catch(() => {}) }
}));
// One loaded page of server rows; paging and URL state are outside these tests.
vi.mock('#lib/tables/convex/create-convex-cursor-table.svelte.ts', () => ({
	createConvexCursorTable: () => ({
		rows: mocks.rows,
		currentUrlState: { search: '' },
		filters: { type: 'all' },
		pageIndex: 0,
		pageSize: 10,
		pageSizes: [10],
		pageCount: 1,
		totalCount: mocks.rows.length,
		hasLoadedCount: true,
		isUnfiltered: true,
		isLoading: false,
		error: null,
		canPreviousPage: false,
		canNextPage: false,
		sortBy: undefined,
		setSort: () => {},
		setFilter: () => {},
		setSearch: () => {},
		setPageSize: () => {},
		goFirst: () => {},
		goPrevious: () => {},
		goNext: () => {},
		goLast: () => {}
	})
}));

import { useDictionary } from '../support/test-fixtures/translation';
import NotificationRecipientsTable from './notification-recipients-table.svelte';

type Field = 'notifyNewSupportTickets' | 'notifyNewSignups';

const emails = ['first@example.com', 'second@example.com', 'third@example.com'];

let component: ReturnType<typeof mount> | undefined;

beforeEach(() => {
	useDictionary(en);
	// jsdom has no ResizeObserver; the email cells measure overflow.
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
	mocks.mutation.mockReset();
	mocks.rows = emails.map((email) => ({
		email,
		isAdminUser: false,
		notifyNewSupportTickets: false,
		notifyUserReplies: false,
		notifyNewSignups: false,
		notifyNewCustomers: false,
		notifyCancellations: false,
		createdAt: 0,
		updatedAt: 0
	}));
	component = mount(NotificationRecipientsTable, { target: document.body });
	flushSync();
	document.querySelector<HTMLElement>(`[aria-label="${en.admin.users.select_all}"]`)!.click();
	flushSync();
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

/** Holds each bulk update open until the test settles it. */
function holdBulkUpdates() {
	const pending = new Map<Field, { reject: (error: Error) => void }>();
	mocks.mutation.mockImplementation(
		(reference: FunctionReference<'mutation'>, args: { field: Field }) => {
			expect(getFunctionName(reference)).toBe(
				'admin/notificationPreferences/mutations:updatePreferences'
			);
			return new Promise((_, reject) => pending.set(args.field, { reject }));
		}
	);
	return pending;
}

const toggle = (field: Field, email: string) =>
	document.querySelector<HTMLElement>(`[data-testid="toggle-${field}-${email}"]`)!;

const shown = (field: Field) =>
	emails.map((email) => toggle(field, email).getAttribute('aria-checked'));

const settle = async () => {
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
};

it('shows the target value on every selected row until the update fails', async () => {
	const updates = holdBulkUpdates();

	toggle('notifyNewSignups', 'second@example.com').click();
	flushSync();

	expect(mocks.mutation).toHaveBeenCalledWith(expect.anything(), {
		emails,
		field: 'notifyNewSignups',
		value: true
	});
	expect(shown('notifyNewSignups')).toEqual(['true', 'true', 'true']);

	updates.get('notifyNewSignups')!.reject(new Error('Refused third@example.com'));
	await settle();

	expect(shown('notifyNewSignups')).toEqual(['false', 'false', 'false']);
});

it('rolls back only the failed field on rows with another update in flight', async () => {
	const updates = holdBulkUpdates();

	toggle('notifyNewSupportTickets', 'first@example.com').click();
	flushSync();
	toggle('notifyNewSignups', 'first@example.com').click();
	flushSync();
	expect(shown('notifyNewSignups')).toEqual(['true', 'true', 'true']);

	updates.get('notifyNewSignups')!.reject(new Error('Refused third@example.com'));
	await settle();

	expect(shown('notifyNewSignups')).toEqual(['false', 'false', 'false']);
	expect(shown('notifyNewSupportTickets')).toEqual(['true', 'true', 'true']);
});
