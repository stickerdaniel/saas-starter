import { afterEach, describe, expect, it, vi } from 'vitest';
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

const calls = vi.hoisted(() => ({ changePassword: vi.fn(), mutation: vi.fn() }));
vi.mock('#lib/auth-client.js', () => ({
	authClient: { changePassword: calls.changePassword }
}));
vi.mock('convex-svelte', () => ({
	setConvexClientContext: () => {},
	useConvexClient: () => ({ mutation: calls.mutation }),
	useQuery: () => ({ data: true })
}));
vi.mock('#lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import en from '../../../../i18n/en.json';
import ChatTestProvider from '#lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import PasswordSettings from './password-settings.svelte';

type Props = { initialHasPassword: boolean };

let component: ReturnType<typeof mount> | undefined;

async function render() {
	component = mount(ChatTestProvider<Props>, {
		target: document.body,
		props: {
			client: {} as ConvexClient,
			content: PasswordSettings as unknown as Svelte.Component<Props>,
			contentProps: { initialHasPassword: true }
		}
	});
	await tick();
	return {
		current: document.querySelector<HTMLInputElement>('#currentPassword')!,
		next: document.querySelector<HTMLInputElement>('#newPassword')!,
		confirm: document.querySelector<HTMLInputElement>('#confirmPassword')!
	};
}

async function type(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
}

function toggleOf(input: HTMLInputElement) {
	const toggle = input.parentElement!.querySelector<HTMLButtonElement>('button');
	expect(toggle, `#${input.id} needs its own visibility toggle`).not.toBeNull();
	return toggle!;
}

function field(input: HTMLInputElement) {
	return input.closest('[data-slot=field]')!;
}

function labelled(text: string) {
	const label = Array.from(document.querySelectorAll('label')).find(
		(element) => element.textContent?.trim() === text
	)!;
	return document.getElementById(label.htmlFor);
}

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.clearAllMocks();
});

describe('password settings fields', () => {
	it('keeps the current and confirmation inputs as they were', async () => {
		const { current, confirm } = await render();
		expect(labelled(en.settings.password.current_password_label)).toBe(current);
		expect(labelled(en.settings.password.confirm_password_label)).toBe(confirm);
		expect(current.name).toBe('currentPassword');
		expect(current.autocomplete).toBe('current-password');
		expect(current.placeholder).toBe(en.settings.password.placeholder.current);
		expect(confirm.name).toBe('confirmPassword');
		expect(confirm.autocomplete).toBe('new-password');
		expect(confirm.placeholder).toBe(en.settings.password.placeholder.confirm);
		for (const input of [current, confirm]) {
			expect(input.type).toBe('password');
			expect(input.disabled).toBe(false);
			expect(input.getAttribute('aria-invalid')).toBeNull();
			expect(input.getAttribute('aria-describedby')).toBeNull();
		}
	});

	it('reveals each password on its own and leaves the values alone', async () => {
		const { current, next, confirm } = await render();
		await type(current, 'old-secret');
		await type(next, 'meadow-L7!orbit-9Cobalt');
		await type(confirm, 'meadow-L7!orbit-9Cobalt');
		expect(toggleOf(current).getAttribute('aria-label')).toBe(en.aria.show_password);
		expect(toggleOf(confirm).getAttribute('aria-label')).toBe(en.aria.show_password);

		toggleOf(current).click();
		await tick();
		expect([current.type, next.type, confirm.type]).toEqual(['text', 'password', 'password']);
		expect(toggleOf(current).getAttribute('aria-label')).toBe(en.aria.hide_password);

		toggleOf(confirm).click();
		await tick();
		expect([current.type, next.type, confirm.type]).toEqual(['text', 'password', 'text']);

		toggleOf(current).click();
		await tick();
		expect([current.type, next.type, confirm.type]).toEqual(['password', 'password', 'text']);
		expect([current.value, next.value, confirm.value]).toEqual([
			'old-secret',
			'meadow-L7!orbit-9Cobalt',
			'meadow-L7!orbit-9Cobalt'
		]);
	});

	it('scores only the new password', async () => {
		const { current, next, confirm } = await render();
		await type(current, 'password');
		await type(next, 'password');
		await type(confirm, 'password');
		await vi.waitFor(() => expect(next.validity.customError).toBe(true), { timeout: 10_000 });

		const meters = document.querySelectorAll('[role=meter]');
		expect(meters).toHaveLength(1);
		expect(field(next).contains(meters[0]!)).toBe(true);
		for (const input of [current, confirm]) {
			expect(input.validity.customError).toBe(false);
			expect(input.getAttribute('aria-invalid')).toBeNull();
		}
	});

	it('ties validation errors to the current and confirmation inputs', async () => {
		const { current, next, confirm } = await render();
		await type(next, 'meadow-L7!orbit-9Cobalt');
		await type(confirm, 'meadow-L7!orbit-9Cobalt-different');
		document.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
		await tick();

		for (const [input, errorId] of [
			[current, 'currentPassword-error'],
			[confirm, 'confirmPassword-error']
		] as const) {
			await vi.waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
			expect(input.getAttribute('aria-describedby')).toBe(errorId);
			expect(document.getElementById(errorId)?.textContent?.trim()).not.toBe('');
		}
		expect(confirm.value).toBe('meadow-L7!orbit-9Cobalt-different');
		expect(calls.changePassword).not.toHaveBeenCalled();
	});
});
