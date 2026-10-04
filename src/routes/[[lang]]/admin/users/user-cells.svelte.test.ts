import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount, type Component } from 'svelte';
import type * as Svelte from 'svelte';
import en from '../../../../i18n/en.json';
import de from '../../../../i18n/de.json';

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
import UserAvatar from './user-avatar.svelte';
import RoleBadge from './role-badge.svelte';
import StatusBadge from './status-badge.svelte';

let component: ReturnType<typeof mount> | undefined;

function render<Props extends Record<string, unknown>>(view: Component<Props>, props: Props) {
	component = mount(view, { target: document.body, props });
	flushSync();
}

const initials = () => document.querySelector('[data-slot="avatar-fallback"]')?.textContent?.trim();
const image = () => document.querySelector('img');

beforeEach(() => {
	useDictionary(en);
	// The name text measures itself for its overflow tooltip.
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
});

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

describe('users table name cell', () => {
	it('shows the first and last initial of the name beside the name', () => {
		render(UserAvatar, { name: 'Grace Brewster Hopper', email: 'grace@example.com' });

		expect(initials()).toBe('GH');
		expect(document.body.textContent).toContain('Grace Brewster Hopper');
	});

	it('falls back to the email initial and a localized placeholder without a name', () => {
		useDictionary(de);
		render(UserAvatar, { email: 'jane.doe@example.com' });

		expect(initials()).toBe('J');
		expect(document.body.textContent).toContain(de.admin.users.unnamed);
	});

	it('keeps the provider image decorative and sends no referrer', () => {
		render(UserAvatar, {
			name: 'John Smith',
			email: 'john@example.com',
			image: 'https://lh3.googleusercontent.com/a/photo'
		});

		expect(image()?.getAttribute('alt')).toBe('');
		expect(image()?.getAttribute('referrerpolicy')).toBe('no-referrer');
	});
});

describe('users table badges', () => {
	it.each([
		['admin', en.admin.users.filter.role_admin],
		['user', en.admin.users.filter.role_user]
	])('labels the %s role', (role, label) => {
		render(RoleBadge, { role, testId: 'admin-users-role-badge' });

		expect(
			document.querySelector('[data-testid="admin-users-role-badge"]')?.textContent?.trim()
		).toBe(label);
	});

	it.each([
		['banned', { banned: true, emailVerified: true }, en.admin.users.banned],
		['verified', { banned: false, emailVerified: true }, en.admin.users.verified],
		['unverified', { banned: false, emailVerified: false }, en.admin.users.unverified]
	])('labels a %s account', (_state, flags, label) => {
		render(StatusBadge, { ...flags, testId: 'admin-users-status-badge' });

		expect(
			document.querySelector('[data-testid="admin-users-status-badge"]')?.textContent?.trim()
		).toBe(label);
	});
});
