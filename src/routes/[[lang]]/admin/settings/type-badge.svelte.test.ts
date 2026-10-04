import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import en from '../../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@tolgee/svelte', async () => {
	const { translation } = await import('../support/test-fixtures/translation');
	const { default: T } = await import('../support/test-fixtures/translated-key.svelte');
	return { getTranslate: () => ({ t: translation }), T };
});

import { useDictionary } from '../support/test-fixtures/translation';
import TypeBadge from './type-badge.svelte';

let component: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

it.each([
	[true, en.admin.settings.type_admin],
	[false, en.admin.settings.type_custom]
])('labels a recipient with isAdmin %s', (isAdmin, label) => {
	useDictionary(en);
	component = mount(TypeBadge, { target: document.body, props: { isAdmin } });
	flushSync();

	expect(document.body.textContent?.trim()).toBe(label);
});
