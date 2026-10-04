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

const calls = vi.hoisted(() => ({ resetPassword: vi.fn() }));
vi.mock('$app/state', () => ({
	page: {
		url: new URL('https://example.com/en/reset-password?token=dummy'),
		params: { lang: 'en' },
		data: { lang: 'en' }
	}
}));
vi.mock('$lib/auth-client.js', () => ({ authClient: { resetPassword: calls.resetPassword } }));
vi.mock('@mmailaender/convex-better-auth-svelte/svelte', () => ({
	useAuth: () => ({ isAuthenticated: false, isLoading: false })
}));
vi.mock('$lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));

import ChatTestProvider from '$lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import ResetPasswordPage from './+page.svelte';

const STRONG = 'meadow-L7!orbit-9Cobalt';
let component: ReturnType<typeof mount> | undefined;

async function render() {
	component = mount(ChatTestProvider<Record<string, never>>, {
		target: document.body,
		props: {
			client: {} as ConvexClient,
			content: ResetPasswordPage as unknown as Svelte.Component<Record<string, never>>,
			contentProps: {}
		}
	});
	await tick();
	const password = byTestId<HTMLInputElement>('reset-password-password-input');
	const confirm = byTestId<HTMLInputElement>('reset-password-confirm-input');
	await vi.waitFor(() => expect(confirm.disabled).toBe(false));
	return { password, confirm };
}

function byTestId<T extends HTMLElement>(id: string) {
	return document.querySelector<T>(`[data-testid="${id}"]`)!;
}

async function type(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
}

function toggleOf(input: HTMLInputElement) {
	const toggle = input.parentElement!.querySelector<HTMLButtonElement>('button');
	expect(toggle, `${input.name} needs its own visibility toggle`).not.toBeNull();
	return toggle!;
}

function submit() {
	byTestId<HTMLButtonElement>('reset-password-submit-button').click();
}

beforeEach(() => {
	calls.resetPassword.mockResolvedValue({ data: { status: true }, error: null });
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.clearAllMocks();
});

describe('reset password confirmation field', () => {
	it('keeps its identity and reveals the confirmation on its own', async () => {
		const { password, confirm } = await render();
		const label = document.querySelector<HTMLLabelElement>(`label[for="${confirm.id}"]`);
		expect(confirm.id).toMatch(/^confirm-password-/);
		expect(label?.textContent?.trim()).toBe('Confirm new password');
		expect(confirm.name).toBe('confirmPassword');
		expect(confirm.autocomplete).toBe('new-password');
		expect(confirm.placeholder).toBe('••••••••');

		await type(password, STRONG);
		await type(confirm, STRONG);
		expect(toggleOf(confirm).getAttribute('aria-label')).toBe('Show password');

		toggleOf(confirm).click();
		await tick();
		expect([password.type, confirm.type]).toEqual(['password', 'text']);
		toggleOf(password).click();
		await tick();
		expect([password.type, confirm.type]).toEqual(['text', 'text']);
		toggleOf(confirm).click();
		await tick();
		expect([password.type, confirm.type]).toEqual(['text', 'password']);
		expect([password.value, confirm.value]).toEqual([STRONG, STRONG]);
	});

	it('scores only the new password', async () => {
		const { password, confirm } = await render();
		await type(password, 'password');
		await type(confirm, 'password');
		await vi.waitFor(() => expect(password.validity.customError).toBe(true), { timeout: 10_000 });

		expect(document.querySelectorAll('[role=meter]')).toHaveLength(1);
		expect(confirm.closest('[data-slot=field]')!.querySelector('[role=meter]')).toBeNull();
		expect(confirm.validity.customError).toBe(false);
		expect(confirm.getAttribute('aria-invalid')).toBeNull();
	});

	it('ties a mismatch to the confirmation field', async () => {
		const { password, confirm } = await render();
		expect(confirm.getAttribute('aria-invalid')).toBeNull();
		expect(confirm.getAttribute('aria-describedby')).toBeNull();
		await type(password, STRONG);
		await type(confirm, `${STRONG}-different`);
		submit();

		await vi.waitFor(() => expect(confirm.getAttribute('aria-invalid')).toBe('true'));
		const error = byTestId('reset-password-confirm-error');
		expect(confirm.getAttribute('aria-describedby')).toBe(error.id);
		expect(error.id).toBe(`${confirm.id}-error`);
		expect(error.textContent?.trim()).not.toBe('');
		expect(calls.resetPassword).not.toHaveBeenCalled();
	});

	it('disables the confirmation once the password is reset', async () => {
		const { password, confirm } = await render();
		await type(password, STRONG);
		await type(confirm, STRONG);
		submit();

		await vi.waitFor(() => expect(byTestId('reset-password-success-message')).not.toBeNull());
		expect(calls.resetPassword).toHaveBeenCalledWith({ newPassword: STRONG, token: 'dummy' });
		expect(confirm.disabled).toBe(true);
		expect(password.disabled).toBe(true);
	});
});
