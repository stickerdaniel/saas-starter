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
							body: 'Hi {{userFirstName}},\n\nOpen [your dashboard](https://app.example.com) **now**.'
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
	// The body editor's tabs measure their active trigger.
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
	component = mount(FounderWelcomeCard, { target: document.body });
	flushSync();
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
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

function openBodyEditor() {
	buttonNamed(founder.edit_button).click();
	flushSync();
	const textarea = document.getElementById('config-body') as HTMLTextAreaElement;
	return textarea;
}

function select(textarea: HTMLTextAreaElement, text: string) {
	const start = textarea.value.indexOf(text);
	textarea.setSelectionRange(start, start + text.length);
}

function pasteOverSelection(text: string, selected: string) {
	const textarea = openBodyEditor();
	select(textarea, selected);
	const paste = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(paste, 'clipboardData', { value: { getData: () => text } });
	textarea.dispatchEvent(paste);
	flushSync();
	return { textarea, handled: paste.defaultPrevented };
}

it('previews the body as the HTML the email sends', async () => {
	await settle();
	openBodyEditor();
	const previewTab = [...document.querySelectorAll('[role="tab"]')].find(
		(tab) => tab.textContent?.trim() === founder.editor_preview
	) as HTMLButtonElement;
	previewTab.click();
	flushSync();

	const preview = [...document.querySelectorAll('[role="tabpanel"]')].find(
		(panel) => !panel.hasAttribute('hidden')
	);
	const link = preview?.querySelector('a');
	expect(preview?.textContent).toContain('Hi Alex,');
	expect(link?.getAttribute('href')).toBe('https://app.example.com');
	expect(link?.textContent).toBe('your dashboard');
	expect(link?.getAttribute('target')).toBe('_blank');
	expect(preview?.querySelector('strong')?.textContent).toBe('now');
});

it('bolds the selected text from the toolbar', async () => {
	await settle();
	const textarea = openBodyEditor();
	select(textarea, 'Hi');
	(
		document.querySelector(`button[aria-label="${founder.editor_bold}"]`) as HTMLButtonElement
	).click();
	flushSync();

	expect(textarea.value.startsWith('**Hi** {{userFirstName}},')).toBe(true);
});

it('keeps its formatting shortcuts from the app shell', async () => {
	await settle();
	const textarea = openBodyEditor();
	const shell = vi.fn();
	window.addEventListener('keydown', shell);
	select(textarea, 'Hi');
	textarea.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true })
	);
	flushSync();
	window.removeEventListener('keydown', shell);

	expect(textarea.value.startsWith('**Hi** {{userFirstName}},')).toBe(true);
	expect(shell).not.toHaveBeenCalled();
});

it('links the selected text when a URL is pasted over it', async () => {
	await settle();
	const { textarea, handled } = pasteOverSelection(' https://app.example.com/start ', 'Hi');

	expect(handled).toBe(true);
	expect(textarea.value.startsWith('[Hi](https://app.example.com/start) {{userFirstName}},')).toBe(
		true
	);
});

it('pastes normally when the clipboard holds no allowed link', async () => {
	await settle();
	const { textarea, handled } = pasteOverSelection('javascript:alert(1)', 'Hi');

	expect(handled).toBe(false);
	expect(textarea.value.startsWith('Hi {{userFirstName}},')).toBe(true);
});
