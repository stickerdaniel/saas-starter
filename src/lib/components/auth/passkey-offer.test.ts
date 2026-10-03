import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';

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
});

const calls = vi.hoisted(() => ({
	create: vi.fn(),
	session: vi.fn(),
	defer: vi.fn(),
	continue: vi.fn()
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

import PasskeyOfferHarness from './test-fixtures/PasskeyOfferHarness.svelte';

let component: ReturnType<typeof mount> | undefined;
function button(name: string) {
	return Array.from(document.querySelectorAll('button')).find(
		(el) => el.textContent?.trim() === name
	)!;
}
async function render() {
	component = mount(PasskeyOfferHarness, {
		target: document.body,
		props: { oncontinue: calls.continue }
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
	await vi.waitFor(() =>
		expect(document.querySelector('[role=status]')?.textContent).toContain(
			'We couldn’t finish setting up your passkey'
		)
	);
	expect(calls.continue).not.toHaveBeenCalled();
	button('Create a passkey').click();
	await vi.waitFor(() =>
		expect(document.querySelector('h1')?.textContent).toBe('Your passkey is ready')
	);
	expect(calls.create).toHaveBeenCalledTimes(2);
	expect(calls.continue).not.toHaveBeenCalled();
	expect(JSON.parse(localStorage.getItem('auth:last-auth-method')!)).toBe('google');
	button('Continue').click();
	expect(calls.continue).toHaveBeenCalledOnce();
});

it('does not claim success for an empty server response', async () => {
	calls.create.mockResolvedValue({ data: null, error: null });
	await render();
	button('Create a passkey').click();
	await vi.waitFor(() =>
		expect(document.querySelector('[role=status]')?.textContent).toContain(
			'We couldn’t finish setting up your passkey'
		)
	);
	expect(document.body.textContent).not.toContain('Your passkey is ready');
});

it('does not enroll a different account after the session changes', async () => {
	calls.session.mockResolvedValue({ data: { session: { id: 'another-session' } }, error: null });
	await render();
	button('Create a passkey').click();
	await vi.waitFor(() =>
		expect(document.querySelector('[role=status]')?.textContent).toContain(
			'We couldn’t finish setting up your passkey'
		)
	);
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
