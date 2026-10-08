import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

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
	// jsdom has no Web Animations; finish each step at once so Field.Error can come and go.
	Object.defineProperty(Element.prototype, 'animate', {
		configurable: true,
		value: () => ({
			cancel() {},
			currentTime: 0,
			playState: 'finished',
			set onfinish(done: () => void) {
				queueMicrotask(done);
			}
		})
	});
});

const calls = vi.hoisted(() => ({
	changeEmail: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn() }
}));
vi.mock('#lib/auth-client.js', () => ({ authClient: { changeEmail: calls.changeEmail } }));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('$app/state', () => ({
	page: { url: new URL('https://example.com/en/app/settings'), params: {}, data: { lang: 'en' } }
}));
vi.mock('svelte-sonner', () => ({ toast: calls.toast }));

import en from '../../../../i18n/en.json';
import { haptic } from '#lib/hooks/use-haptic.svelte.ts';
import ChatTestProvider from '#lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import EmailSettings from './email-settings.svelte';

type Props = { user: { email: string; emailVerified: boolean } };

let component: ReturnType<typeof mount> | undefined;

async function render() {
	component = mount(ChatTestProvider<Props>, {
		target: document.body,
		props: {
			client: {} as ConvexClient,
			content: EmailSettings as unknown as Svelte.Component<Props>,
			contentProps: { user: { email: 'ada@example.com', emailVerified: true } }
		}
	});
	await tick();
}

function emailInput() {
	return document.querySelector<HTMLInputElement>('#newEmail')!;
}

function submitButton() {
	return document.querySelector<HTMLButtonElement>('button[type=submit]')!;
}

async function submit(email: string) {
	emailInput().value = email;
	emailInput().dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
	submitButton().click();
}

function occurrences(text: string) {
	return document.body.textContent!.split(text).length - 1;
}

beforeEach(() => {
	calls.changeEmail.mockResolvedValue({ data: { status: true }, error: null });
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.clearAllMocks();
	calls.changeEmail.mockReset();
});

describe('email change feedback', () => {
	it.each([
		['the current address', 'ada@example.com', undefined, en.auth.messages.email_same_as_current],
		[
			'a returned error',
			'grace@example.com',
			{ data: null, error: { code: 'USER_ALREADY_EXISTS' } },
			en.auth.messages.user_already_exists
		],
		[
			'a thrown error',
			'grace@example.com',
			new Error('offline'),
			en.auth.messages.email_change_failed
		]
	])('reports %s once, inline', async (_, email, outcome, message) => {
		if (outcome instanceof Error) calls.changeEmail.mockRejectedValue(outcome);
		else if (outcome) calls.changeEmail.mockResolvedValue(outcome);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await render();
		await submit(email);

		await vi.waitFor(() => expect(occurrences(message)).toBe(1));
		await vi.waitFor(() => expect(submitButton().disabled).toBe(false));
		const alerts = Array.from(document.querySelectorAll('[role=alert]'));
		expect(alerts.filter((alert) => alert.textContent?.includes(message))).toHaveLength(1);
		expect(calls.toast.error).not.toHaveBeenCalled();
		expect(calls.toast.success).not.toHaveBeenCalled();
		expect(haptic.trigger).toHaveBeenCalledExactlyOnceWith('error');
		expect(submitButton().textContent?.trim()).toBe(en.settings.email.update_button);
		expect(emailInput().value).toBe(email);
	});

	it('confirms a requested change with a toast and clears the field', async () => {
		await render();
		await submit('grace@example.com');

		await vi.waitFor(() =>
			expect(calls.toast.success).toHaveBeenCalledWith(en.auth.messages.email_verification_sent)
		);
		expect(calls.changeEmail).toHaveBeenCalledWith({
			newEmail: 'grace@example.com',
			callbackURL: '/en/app/settings?email-changed=true'
		});
		expect(haptic.trigger).toHaveBeenCalledExactlyOnceWith('success');
		expect(calls.toast.error).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(emailInput().value).toBe(''));
		expect(document.querySelector('[role=alert]')).toBeNull();
	});
});
