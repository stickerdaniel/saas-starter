import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { getFunctionName, type FunctionReference } from 'convex/server';
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

const mocks = vi.hoisted(() => ({
	mutation: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('svelte-sonner', () => ({ toast: mocks.toast }));
vi.mock('convex-svelte', () => ({
	useConvexClient: () => ({ mutation: mocks.mutation }),
	useQuery: (query: FunctionReference<'query'>) => ({
		data:
			getFunctionName(query) === 'users:viewer'
				? { _id: 'viewer_1' }
				: {
						config: {
							enabled: true,
							contactUser: { id: 'viewer_1' },
							name: 'Ada',
							title: 'Founder',
							subject: 'Welcome',
							body: 'Hi {{userFirstName}}'
						},
						viewerProfile: { name: 'Ada', title: 'Founder', replyTo: '' }
					},
		error: undefined,
		isLoading: false
	})
}));

import { useDictionary } from '../support/test-fixtures/translation';
import FounderWelcomeCard from './founder-welcome-card.svelte';

let component: ReturnType<typeof mount> | undefined;

beforeEach(() => {
	useDictionary(en);
	mocks.mutation.mockReset();
	mocks.toast.error.mockReset();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	component = mount(FounderWelcomeCard, { target: document.body });
	flushSync();
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

const founder = en.admin.settings.founder_welcome;
const buttonNamed = (name: string, root: ParentNode = document) =>
	[...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === name)!;
const alert = () => document.querySelector('[role="alertdialog"]');
const alertOpen = () => alert()?.getAttribute('data-state') === 'open';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function openStepDown() {
	buttonNamed(founder.edit_button).click();
	flushSync();
	buttonNamed(founder.step_down).click();
	flushSync();
	expect(alertOpen()).toBe(true);
}

it('blocks dismissing the step-down while it is pending and stays open on failure', async () => {
	let reject!: (error: Error) => void;
	mocks.mutation.mockReturnValue(new Promise((_, rej) => (reject = rej)));
	openStepDown();

	const confirm = buttonNamed(founder.step_down, alert()!);
	confirm.click();
	confirm.click();
	flushSync();
	expect(mocks.mutation).toHaveBeenCalledTimes(1);

	document.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
	);
	buttonNamed(founder.cancel, alert()!).click();
	flushSync();
	expect(alertOpen()).toBe(true);
	expect(buttonNamed(founder.cancel, alert()!).disabled).toBe(true);

	reject(new Error('backend down'));
	await settle();
	flushSync();

	expect(mocks.toast.error).toHaveBeenCalledWith(founder.error);
	expect(alertOpen()).toBe(true);
	expect(buttonNamed(founder.step_down, alert()!).disabled).toBe(false);
	expect(buttonNamed(founder.cancel, alert()!).disabled).toBe(false);
});
