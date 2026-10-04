import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type * as PasskeyNudge from '$lib/utils/passkey-nudge';
import en from '../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
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
	create: vi.fn(),
	session: vi.fn(),
	defer: vi.fn(),
	continue: vi.fn(),
	created: vi.fn(),
	toast: vi.fn()
}));
vi.mock('$lib/auth-client', () => ({
	authClient: {
		getSession: calls.session,
		useSession: () => ({
			subscribe: (listener: (snapshot: unknown) => void) => {
				listener({ data: { session: { id: 'session-a' } } });
				return () => {};
			}
		}),
		passkey: { addPasskey: calls.create }
	}
}));
vi.mock('convex-svelte', () => ({ useConvexClient: () => ({ mutation: calls.defer }) }));
vi.mock('svelte-sonner', () => ({ toast: { success: calls.toast } }));
vi.mock('@mmailaender/convex-better-auth-svelte/svelte', () => ({
	useAuth: () => ({ isLoading: false, isAuthenticated: true })
}));
vi.mock('$lib/utils/passkey-nudge', async (importOriginal) => ({
	...(await importOriginal<typeof PasskeyNudge>()),
	claimPasskeyNudge: async () => ({
		userId: 'user-a',
		sessionId: 'session-a',
		name: 'Daniel Example',
		email: 'daniel@example.com'
	})
}));

import { pendingPasskeyNudge } from '$lib/hooks/passkey-nudge.svelte.ts';
import PasskeyOfferHarness from './test-fixtures/PasskeyOfferHarness.svelte';

let component: ReturnType<typeof mount> | undefined;
function button(name: string) {
	return Array.from(document.querySelectorAll('button')).find(
		(el) => el.textContent?.trim() === name
	)!;
}
function nameInput() {
	return document.querySelector<HTMLInputElement>('input')!;
}
function failure() {
	return document.querySelector('[role=alert]')?.textContent;
}
async function render(sidebar = false) {
	if (sidebar) pendingPasskeyNudge.current = { sessionId: 'session-a', provider: 'google' };
	component = mount(PasskeyOfferHarness, {
		target: document.body,
		props: { oncontinue: calls.continue, oncreated: calls.created, sidebar }
	});
	await tick();
	await vi.waitFor(() => expect(button('Create a passkey')).toBeDefined());
}

beforeEach(() => {
	localStorage.clear();
	localStorage.setItem('auth:last-auth-method', JSON.stringify('google'));
	calls.session.mockResolvedValue({ data: { session: { id: 'session-a' } }, error: null });
	calls.create.mockResolvedValue({ data: { id: 'registered-passkey' }, error: null });
	calls.defer.mockResolvedValue(null);
});
afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.resetAllMocks();
});

it('waits for consent, allows cancellation and retry, and confirms only verified creation', async () => {
	calls.create.mockResolvedValueOnce({
		data: null,
		error: { code: 'ERROR_CEREMONY_ABORTED', status: 400 }
	});
	await render();
	expect(calls.create).not.toHaveBeenCalled();
	button('Create a passkey').click();
	await vi.waitFor(() => expect(failure()).toContain('We couldn’t finish setting up your passkey'));
	expect(calls.continue).not.toHaveBeenCalled();
	expect(calls.toast).not.toHaveBeenCalled();
	button('Create a passkey').click();
	await vi.waitFor(() => expect(calls.created).toHaveBeenCalledOnce());
	expect(calls.create).toHaveBeenCalledTimes(2);
	expect(calls.toast).toHaveBeenCalledWith('Passkey added successfully');
	expect(calls.continue).not.toHaveBeenCalled();
	expect(JSON.parse(localStorage.getItem('auth:last-auth-method')!)).toBe('google');
});

it.each([
	['a server code with its own message', { data: null, error: { code: 'SESSION_NOT_FRESH' } }],
	['an unknown server code', { data: null, error: { code: 'SOMETHING_NEW', status: 500 } }],
	['a thrown error', new Error('offline')],
	['an empty server response', { data: null, error: null }]
])('reports only its generic failure for %s', async (_, outcome) => {
	if (outcome instanceof Error) calls.create.mockRejectedValue(outcome);
	else calls.create.mockResolvedValue(outcome);
	await render();
	button('Create a passkey').click();
	await vi.waitFor(() => expect(failure()).toContain('We couldn’t finish setting up your passkey'));
	expect(document.body.textContent).not.toContain(en.auth.messages.session_not_fresh);
	expect(document.body.textContent).not.toContain(en.auth.messages.passkey_add_failed);
	expect(calls.created).not.toHaveBeenCalled();
	expect(calls.toast).not.toHaveBeenCalled();
});

it('does not enroll a different account after the session changes', async () => {
	calls.session.mockResolvedValue({ data: { session: { id: 'another-session' } }, error: null });
	await render();
	button('Create a passkey').click();
	await vi.waitFor(() => expect(failure()).toContain('We couldn’t finish setting up your passkey'));
	expect(calls.create).not.toHaveBeenCalled();
});

it('continues after a deferral even if saving it fails', async () => {
	calls.defer.mockRejectedValue(new Error('offline'));
	await render();
	button('Not now').click();
	await vi.waitFor(() => expect(calls.continue).toHaveBeenCalledOnce());
	expect(Number(localStorage.getItem('auth:passkey-nudge:deferred:user-a'))).toBeGreaterThan(
		Date.now()
	);
	expect(calls.create).not.toHaveBeenCalled();
});

it('prefills the suggested name and registers the name the visitor typed', async () => {
	await render();
	expect(nameInput().labels?.[0]?.textContent?.trim()).toBe('Passkey name');
	expect(nameInput().value).toMatch(/^Daniel’s \S/);
	nameInput().value = 'Work laptop';
	nameInput().dispatchEvent(new Event('input', { bubbles: true }));
	button('Create a passkey').click();
	await vi.waitFor(() => expect(calls.created).toHaveBeenCalledOnce());
	expect(calls.create).toHaveBeenCalledWith({ name: 'Work laptop' });
});

it('falls back to the suggested name when the field is left blank', async () => {
	await render();
	const suggested = nameInput().value;
	nameInput().value = '   ';
	nameInput().dispatchEvent(new Event('input', { bubbles: true }));
	button('Create a passkey').click();
	await vi.waitFor(() => expect(calls.create).toHaveBeenCalledOnce());
	expect(calls.create).toHaveBeenCalledWith({ name: suggested });
});

it('confirms a sidebar registration with a toast and closes the offer', async () => {
	await render(true);
	expect(nameInput().value).toMatch(/^Daniel’s \S/);
	nameInput().value = 'Work laptop';
	nameInput().dispatchEvent(new Event('input', { bubbles: true }));
	button('Create a passkey').click();
	await vi.waitFor(() => expect(document.querySelector('form')).toBeNull());
	expect(calls.create).toHaveBeenCalledWith({ name: 'Work laptop' });
	expect(calls.toast).toHaveBeenCalledWith('Passkey added successfully');
});

it('keeps the sidebar offer open with an announced error when registration fails', async () => {
	calls.create.mockResolvedValue({ data: null, error: { code: 'ERROR_CEREMONY_ABORTED' } });
	await render(true);
	button('Create a passkey').click();
	await vi.waitFor(() => expect(failure()).toContain('We couldn’t finish setting up your passkey'));
	expect(calls.toast).not.toHaveBeenCalled();
	expect(document.querySelector('form')).not.toBeNull();
});

it('keeps the typed name and a pending registration when the sidebar card remounts', async () => {
	let finish!: (value: unknown) => void;
	calls.create.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
	await render(true);
	nameInput().value = 'Work laptop';
	nameInput().dispatchEvent(new Event('input', { bubbles: true }));
	button('Remount card').click();
	await tick();
	button('Remount card').click();
	await tick();
	expect(nameInput().value).toBe('Work laptop');
	button('Create a passkey').click();
	await vi.waitFor(() => expect(calls.create).toHaveBeenCalledOnce());
	button('Remount card').click();
	await tick();
	button('Remount card').click();
	await tick();
	expect(button('Please wait…').disabled).toBe(true);
	finish({ data: { id: 'registered-passkey' }, error: null });
	await vi.waitFor(() => expect(document.querySelector('form')).toBeNull());
	expect(calls.create).toHaveBeenCalledWith({ name: 'Work laptop' });
});
