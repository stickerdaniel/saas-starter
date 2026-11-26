import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type { NotificationRecipient } from '#lib/confect/admin/notificationPreferences/queries.js';
import en from '../../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

type Translate = (key: string, params?: Record<string, unknown>) => string;

const translation = vi.hoisted(() => ({
	current: (() => '') as Translate,
	subscribe(run: (value: Translate) => void) {
		run(this.current);
		return () => {};
	}
}));
vi.mock('@tolgee/svelte', () => ({ getTranslate: () => ({ t: translation }) }));

import RecipientsSelectionTable from './test-fixtures/RecipientsSelectionTable.svelte';

translation.current = (key, params = {}) => {
	const template = key
		.split('.')
		.reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);
	if (typeof template !== 'string') throw new Error(`Missing translation ${key}`);
	return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]));
};

let component: ReturnType<typeof RecipientsSelectionTable> | undefined;

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

function recipient(email: string): NotificationRecipient {
	return {
		email,
		isAdminUser: false,
		notifyNewSupportTickets: false,
		notifyUserReplies: false,
		notifyNewSignups: false,
		notifyNewCustomers: false,
		notifyCancellations: false,
		createdAt: 0,
		updatedAt: 0
	};
}

const text = (testId: string) =>
	document.querySelector(`[data-testid="${testId}"]`)!.textContent?.trim();

const toggle = (email: string) =>
	document.querySelector<HTMLElement>(`[data-testid="toggle-notifyNewSignups-${email}"]`)!.click();

it('bulk toggles only the selected recipients that are still listed', async () => {
	const onToggleMany = vi.fn();
	const [first, second, third] = [
		recipient('first@example.com'),
		recipient('second@example.com'),
		recipient('third@example.com')
	];
	component = mount(RecipientsSelectionTable, {
		target: document.body,
		props: { recipients: [first, second, third], onToggleMany }
	});
	flushSync();

	component.selectPage();
	flushSync();
	expect(text('footer')).toBe('3 of 3 selected');

	// The third recipient leaves the rows, for example after it was removed.
	component.setRecipients([first, second]);
	flushSync();

	expect(text('context-selection')).toBe('first@example.com,second@example.com');
	expect(text('footer')).toBe('2 of 2 selected');

	toggle('first@example.com');
	await tick();

	expect(onToggleMany.mock.calls).toEqual([
		[['first@example.com', 'second@example.com'], 'notifyNewSignups', true]
	]);
});
