import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { computeAccessibleName } from 'dom-accessibility-api';
import en from '../../../i18n/en.json';
import de from '../../../i18n/de.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@tolgee/svelte', async () => {
	const { translation } = await import('./support/test-fixtures/translation');
	const { default: T } = await import('./support/test-fixtures/translated-key.svelte');
	return { getTranslate: () => ({ t: translation }), T };
});
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: () => {} } }));
vi.mock('convex-svelte', () => ({ useQuery: () => ({ data: undefined }) }));

import { useDictionary } from './support/test-fixtures/translation';
import { tableContent } from './test-fixtures/table-content.svelte';
import UserFilters from './users/data-table-filters.svelte';
import AuditFilters from './audit-log/data-table-filters.svelte';
import SettingsFilters from './settings/data-table-filters.svelte';
import TableShell from '#lib/components/tables/convex-cursor-table-shell.svelte';

const components: Array<ReturnType<typeof mount>> = [];
const noop = () => {};

afterEach(async () => {
	for (const component of components.splice(0)) await unmount(component);
	document.body.replaceChildren();
});

function renderControls(active: boolean, rowsPerPageLabel?: string) {
	components.push(
		mount(UserFilters, {
			target: document.body,
			props: {
				roleFilter: active ? 'admin' : undefined,
				statusFilter: active ? 'verified' : undefined,
				providerFilter: active ? 'credential' : undefined,
				availableOAuthProviders: {},
				onFilterChange: noop
			}
		}),
		mount(AuditFilters, {
			target: document.body,
			props: {
				actionFilter: active ? 'ban_user' : undefined,
				adminUserId: undefined,
				targetUserId: undefined,
				onFilterChange: noop,
				onClearUserFilter: noop
			}
		}),
		mount(SettingsFilters, {
			target: document.body,
			props: { typeFilter: active ? 'admin' : 'all', onFilterChange: noop }
		}),
		mount(TableShell, {
			target: document.body,
			props: {
				testIdPrefix: 'items',
				searchValue: '',
				searchPlaceholder: '',
				onSearchChange: noop,
				pageIndex: 0,
				pageCount: 1,
				pageSize: active ? 50 : 10,
				pageSizeOptions: [10, 50],
				canPreviousPage: false,
				canNextPage: false,
				onFirstPage: noop,
				onPreviousPage: noop,
				onNextPage: noop,
				onLastPage: noop,
				onPageSizeChange: noop,
				rowsPerPageLabel,
				tableContent
			}
		})
	);
	flushSync();
}

const names = () =>
	[...document.querySelectorAll('[role="combobox"]')].map((element) =>
		computeAccessibleName(element)
	);

describe.each([
	{ locale: 'en', dictionary: en },
	{ locale: 'de', dictionary: de }
])('admin select names in $locale', ({ dictionary }) => {
	it.each([false, true])(
		'names the controls rather than their selected values (active: %s)',
		(active) => {
			useDictionary(dictionary);
			renderControls(active);

			expect(names()).toEqual([
				dictionary.admin.users.role,
				dictionary.admin.users.status,
				dictionary.admin.users.provider,
				dictionary.admin.audit_log.column.action,
				dictionary.admin.settings.column_type,
				dictionary.table.rows_per_page
			]);
		}
	);
});

it('uses a supplied page-size label for the accessible name too', () => {
	useDictionary(en);
	renderControls(false, 'Entries per page');

	expect(names().at(-1)).toBe('Entries per page');
});
