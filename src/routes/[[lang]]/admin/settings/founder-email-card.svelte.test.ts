import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { api } from '#lib/convex/_generated/api.js';
import type { FounderEmail } from '#lib/convex/emails/founderEmailConfig.js';
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

type EmailConfig = {
	senderUserId: string | null;
	name: string;
	title: string;
	replyTo: string;
	subject: string;
	body: string;
};

const mocks = vi.hoisted(() => ({
	mutation: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn() },
	configs: {} as Record<string, EmailConfig>
}));

vi.mock('svelte-sonner', () => ({ toast: mocks.toast }));
vi.mock('convex-svelte', () => ({
	useConvexClient: () => ({ mutation: mocks.mutation }),
	useQuery: (query: FunctionReference<'query'>) => ({
		data: getFunctionName(query) === 'users:viewer' ? { _id: 'viewer_1' } : mocks.configs,
		error: undefined,
		isLoading: false
	})
}));

import { useDictionary } from '../support/test-fixtures/translation';
import FounderEmailCard from './founder-email-card.svelte';

// The viewer sends every email, so the edit dialog offers Stop Sending.
const senderConfig = (): EmailConfig => ({
	senderUserId: 'viewer_1',
	name: 'Ada',
	title: 'Founder',
	replyTo: '',
	subject: 'Welcome',
	body: 'Hi {{userFirstName}},\n\nOpen [your dashboard](https://app.example.com) **now**.'
});

let component: ReturnType<typeof mount> | undefined;

beforeEach(() => {
	useDictionary(en);
	mocks.mutation.mockReset();
	mocks.toast.error.mockReset();
	mocks.toast.success.mockReset();
	mocks.configs = {
		welcome: senderConfig(),
		feedback: senderConfig(),
		cancellation: senderConfig()
	};
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
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	// bits-ui releases its body scroll lock on a timer; let it run inside jsdom.
	await new Promise((resolve) => setTimeout(resolve, 50));
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const founder = en.admin.settings.founder_welcome;
const buttonNamed = (name: string, root: ParentNode = document) =>
	[...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === name)!;
const alert = () => document.querySelector('[role="alertdialog"]');
const alertOpen = () => alert()?.getAttribute('data-state') === 'open';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const callsTo = (reference: FunctionReference<'mutation'>) =>
	mocks.mutation.mock.calls.filter(
		([called]) => getFunctionName(called) === getFunctionName(reference)
	);

function mountCard(email: FounderEmail) {
	component = mount(FounderEmailCard, { target: document.body, props: { email } });
	flushSync();
}

function openStop(email: FounderEmail) {
	mountCard(email);
	buttonNamed(founder.edit_button).click();
	flushSync();
	buttonNamed(founder.stop_sending).click();
	flushSync();
	expect(alertOpen()).toBe(true);
}

describe.each(['welcome', 'feedback', 'cancellation'] as const)('the %s email card', (email) => {
	it('blocks dismissing the stop while it is pending and stays open on failure', async () => {
		let reject!: (error: Error) => void;
		mocks.mutation.mockReturnValue(new Promise((_, rej) => (reject = rej)));
		openStop(email);

		const stop = buttonNamed(founder.stop_sending, alert()!);
		stop.click();
		stop.click();
		flushSync();
		expect(callsTo(api.admin.founderWelcome.mutations.disableEmail)).toEqual([
			[api.admin.founderWelcome.mutations.disableEmail, { email }]
		]);

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
		expect(buttonNamed(founder.stop_sending, alert()!).disabled).toBe(false);
		expect(buttonNamed(founder.cancel, alert()!).disabled).toBe(false);
	});

	it('closes once the email is stopped', async () => {
		mocks.mutation.mockResolvedValue(null);
		openStop(email);

		buttonNamed(founder.stop_sending, alert()!).click();
		await settle();
		flushSync();

		expect(callsTo(api.admin.founderWelcome.mutations.disableEmail)).toHaveLength(1);
		expect(mocks.toast.success).toHaveBeenCalledWith(founder.stopped_sending);
		expect(alertOpen()).toBe(false);
	});

	it('saves the dialog as this email, with the viewer as its sender', async () => {
		mocks.configs[email] = { ...senderConfig(), senderUserId: null };
		mocks.mutation.mockResolvedValue(null);
		mountCard(email);

		buttonNamed(founder.become_sender).click();
		flushSync();
		buttonNamed(founder.become_sender, document.querySelector('[role="dialog"]')!).click();
		await settle();

		expect(callsTo(api.admin.founderWelcome.mutations.updateEmailConfig)).toEqual([
			[
				api.admin.founderWelcome.mutations.updateEmailConfig,
				{
					email,
					name: 'Ada',
					title: 'Founder',
					replyTo: undefined,
					subject: 'Welcome',
					body: senderConfig().body
				}
			]
		]);
	});
});

it('shows who sends an email and leaves editing to them', () => {
	mocks.configs.feedback = { ...senderConfig(), senderUserId: 'admin_2', name: 'Grace' };
	mountCard('feedback');

	expect(document.body.textContent).toContain('Sending as Grace');
	expect(buttonNamed(founder.edit_button).disabled).toBe(true);
});

function openBodyEditor() {
	mountCard('welcome');
	buttonNamed(founder.edit_button).click();
	flushSync();
	const textarea = document.getElementById('founder-welcome-body') as HTMLTextAreaElement;
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

const toolbarButton = (label: string) =>
	document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

it('shows the format at the caret as on and turns it off', async () => {
	await settle();
	const textarea = openBodyEditor();
	const at = textarea.value.indexOf('now') + 1;
	textarea.setSelectionRange(at, at);
	textarea.dispatchEvent(new Event('selectionchange'));
	flushSync();

	expect(toolbarButton(founder.editor_bold).getAttribute('aria-pressed')).toBe('true');
	expect(toolbarButton(founder.editor_link).disabled).toBe(true);

	toolbarButton(founder.editor_bold).click();
	flushSync();

	expect(textarea.value.endsWith(') now.')).toBe(true);
	expect(toolbarButton(founder.editor_bold).getAttribute('aria-pressed')).toBe('false');
});

it('continues a list on Enter', async () => {
	await settle();
	const textarea = openBodyEditor();
	textarea.value = '- One';
	textarea.dispatchEvent(new Event('input', { bubbles: true }));
	textarea.setSelectionRange(5, 5);
	const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
	textarea.dispatchEvent(enter);
	flushSync();

	expect(enter.defaultPrevented).toBe(true);
	expect(textarea.value).toBe('- One\n- ');
	expect(textarea.selectionStart).toBe(8);
});
