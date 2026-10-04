import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type { AuditLogItem } from '$lib/convex/admin/auditLog/queries';
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
import UserRefCell from './user-ref-cell.svelte';

const TEST_ID = 'audit-log-admin-cell';

let component: ReturnType<typeof mount> | undefined;

function render(user: AuditLogItem['admin'] | undefined, onFilter?: () => void) {
	component = mount(UserRefCell, {
		target: document.body,
		props: { user, kind: 'admin', onFilter, testId: TEST_ID }
	});
	flushSync();
}

const initials = () => document.querySelector('[data-slot="avatar-fallback"]')?.textContent?.trim();
const image = () => document.querySelector('img');

beforeEach(() => useDictionary(en));

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

it('shows the name initials beside a decorative image that sends no referrer', () => {
	render({
		id: 'user-1',
		name: 'Ada Lovelace',
		email: 'ada@example.com',
		image: 'https://lh3.googleusercontent.com/a/photo',
		exists: true
	});

	expect(initials()).toBe('AL');
	expect(image()?.getAttribute('alt')).toBe('');
	expect(image()?.getAttribute('referrerpolicy')).toBe('no-referrer');
});

it('falls back to the email initial for a user without a name', () => {
	render({ id: 'user-2', email: 'zoe@example.com', exists: true }, () => {});

	expect(initials()).toBe('Z');
	expect(document.querySelector(`[data-testid="${TEST_ID}"]`)?.textContent).toContain(
		'zoe@example.com'
	);
});

it('marks a deleted user with a question mark and no image', () => {
	render({ id: 'deleted-user-id', exists: false });

	expect(initials()).toBe('?');
	// The image element stays mounted without a source, hidden.
	expect(image()?.getAttribute('src') ?? null).toBeNull();
	expect(image()?.style.display ?? 'none').toBe('none');
	expect(document.body.textContent).toContain(en.admin.audit_log.deleted_user);
});

it('renders an inert, hidden placeholder while the row loads', () => {
	render(undefined);

	const placeholder = document.querySelector('button')!;
	expect(placeholder.hasAttribute('inert')).toBe(true);
	expect(placeholder.getAttribute('aria-hidden')).toBe('true');
	expect(placeholder.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
	expect(document.querySelector('[data-slot="avatar"]')).toBeNull();
	expect(document.querySelector(`[data-testid="${TEST_ID}"]`)).toBeNull();
});
