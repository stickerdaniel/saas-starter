import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspect } from 'node:util';
import { getFunctionName } from 'convex/server';
import type { ConvexClient } from 'convex/browser';
import { mount, tick, unmount, type Component } from 'svelte';
import type * as Svelte from 'svelte';
import { toast } from 'svelte-sonner';
import { goto } from '$app/navigation';
import en from '../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

const state = vi.hoisted(() => ({
	page: {
		url: new URL('https://example.com/en/pricing'),
		params: { lang: 'en' },
		data: {} as Record<string, unknown>
	}
}));

const autumn = vi.hoisted(() => ({
	customer: {
		products: [] as Array<{ id: string }>,
		features: { ai_chat_messages: { balance: 5, included_usage: 10 } }
	},
	checkout: vi.fn(),
	attach: vi.fn(),
	openBillingPortal: vi.fn(),
	refetch: vi.fn(),
	errors: new Map<unknown, Error>()
}));

const threadChat = vi.hoisted(() => vi.fn());

vi.mock('$app/state', () => ({ page: state.page }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('@stickerdaniel/convex-autumn-svelte/sveltekit', () => ({
	useCustomer: () => autumn,
	// Mirrors the wrapper: a failed action resolves to null and exposes its error.
	useAutumnOperation: (action: (...args: unknown[]) => unknown) => ({
		execute: action,
		isLoading: false,
		get error() {
			return autumn.errors.get(action) ?? null;
		}
	})
}));
vi.mock('@mmailaender/convex-better-auth-svelte/svelte', () => ({
	useAuth: () => ({ isAuthenticated: true, isLoading: false })
}));
vi.mock('$lib/auth-client', () => ({
	authClient: {
		useSession: () => ({
			subscribe: (callback: (value: unknown) => void) => {
				callback({ data: { user: { id: 'user-1' }, session: {} }, isPending: false });
				return () => {};
			}
		})
	}
}));
vi.mock('runed/kit', () => ({ useSearchParams: () => ({ checkout: '' }) }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('$lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('$lib/components/SEOHead.svelte', () => ({ default: () => {} }));
vi.mock('../../../routes/[[lang]]/app/ai-chat/thread-chat.svelte', () => ({
	default: threadChat
}));

import ChatTestProvider from '$lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import CheckoutProviderHarness from './test-fixtures/CheckoutProviderHarness.svelte';
import NavUserHarness from './test-fixtures/NavUserHarness.svelte';
import PricingThree from '$blocks/pricing/pricing-three.svelte';
import AIChatPage from '../../../routes/[[lang]]/app/ai-chat/+page.svelte';

// Carried by every rejected operation below; no console argument may reveal it.
const secret = 'provider-secret-5a';
const usable = { usable: true } as const;
const unavailable = { usable: false, reason: 'unavailable' } as const;

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;
let consoleOutput: () => string;

async function mountUnderProvider<Props extends Record<string, unknown>>(
	content: Component<Props>,
	contentProps: Props
): Promise<void> {
	component = mount(ChatTestProvider, {
		target: document.body,
		props: {
			client,
			content: CheckoutProviderHarness as unknown as Component<Record<string, unknown>>,
			contentProps: { content, contentProps }
		}
	});
	await tick();
}

function statusText(): string {
	return [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent).join();
}

beforeEach(() => {
	state.page.url = new URL('https://example.com/en/pricing');
	state.page.data = {};
	autumn.errors.clear();
	autumn.checkout.mockReset();
	autumn.attach.mockReset();
	autumn.openBillingPortal.mockReset().mockResolvedValue(null);
	threadChat.mockReset();
	// The sidebar reads the viewport and observes its own size.
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: false,
		media: query,
		addEventListener() {},
		removeEventListener() {}
	}));
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
	vi.mocked(toast.error).mockClear();
	vi.mocked(goto).mockClear();
	client = {
		disabled: false,
		closed: false,
		client: { localQueryResult: () => undefined },
		onUpdate: () => () => {},
		mutation: vi.fn(() => new Promise(() => {})),
		query: vi.fn()
	} as unknown as ConvexClient;
	const spies = (['error', 'warn', 'info', 'log', 'debug'] as const).map((method) =>
		vi.spyOn(console, method).mockImplementation(() => {})
	);
	consoleOutput = () =>
		inspect(
			spies.map((spy) => spy.mock.calls),
			{ depth: null }
		);
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('billing checkout provider', () => {
	function checkoutButton(): HTMLButtonElement {
		return document.querySelector<HTMLButtonElement>('[data-testid="pricing-checkout-pro"]')!;
	}

	it.each([
		['unresolved', {}],
		['unavailable', { capabilities: { billing: unavailable, ai: usable } }],
		[
			'unavailable without the local override',
			{ capabilities: { billing: unavailable, ai: usable }, localE2E: { billing: false } }
		]
	])('offers no checkout while billing is %s', async (_state, data) => {
		state.page.data = data;
		await mountUnderProvider(PricingThree, {});

		expect(checkoutButton().disabled).toBe(true);
		expect(statusText()).toContain(en.capabilities.billing_unavailable);
		checkoutButton().click();
		await tick();
		expect(autumn.checkout).not.toHaveBeenCalled();
	});

	it.each([
		['usable', { capabilities: { billing: usable, ai: unavailable } }],
		['enabled by the local e2e override', { localE2E: { billing: true } }]
	])('starts checkout when billing is %s', async (_state, data) => {
		state.page.data = data;
		autumn.checkout.mockReturnValue(new Promise(() => {}));
		await mountUnderProvider(PricingThree, {});

		expect(statusText()).not.toContain(en.capabilities.billing_unavailable);
		checkoutButton().click();
		await tick();
		expect(autumn.checkout).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ productId: 'pro' })
		);
	});

	it('reports a failed checkout with a fixed diagnostic', async () => {
		state.page.data = { capabilities: { billing: usable, ai: unavailable } };
		autumn.checkout.mockResolvedValue(null);
		autumn.errors.set(autumn.checkout, new Error(secret));
		await mountUnderProvider(PricingThree, {});

		checkoutButton().click();

		await vi.waitFor(() =>
			expect(toast.error).toHaveBeenCalledExactlyOnceWith(en.billing.checkout_failed)
		);
		expect(console.error).toHaveBeenCalledExactlyOnceWith('[BillingCheckout.start] Failed');
		expect(consoleOutput()).not.toContain(secret);
	});

	it('keeps a failed confirmation retryable with a fixed diagnostic', async () => {
		state.page.data = { capabilities: { billing: usable, ai: unavailable } };
		autumn.checkout.mockResolvedValue({
			url: null,
			customer_id: 'customer_1',
			has_prorations: false,
			lines: [{ description: 'Pro - $10 / month', amount: 10, item: {} }],
			total: 10,
			currency: 'usd',
			options: [],
			product: { id: 'pro', name: 'Pro', items: [] }
		});
		autumn.attach.mockResolvedValue(null);
		autumn.errors.set(autumn.attach, new Error(secret));
		await mountUnderProvider(PricingThree, {});
		checkoutButton().click();
		const confirm = await vi.waitFor(() => {
			const button = document.querySelector<HTMLButtonElement>(
				'[data-testid="billing-checkout-confirm"]'
			);
			expect(button).not.toBeNull();
			return button!;
		});

		confirm.click();

		await vi.waitFor(() =>
			expect(toast.error).toHaveBeenCalledExactlyOnceWith(en.billing.attach_failed)
		);
		expect(autumn.attach).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ productId: 'pro' })
		);
		expect(console.error).toHaveBeenCalledExactlyOnceWith('[BillingCheckout.confirm] Failed');
		expect(consoleOutput()).not.toContain(secret);
		await tick();
		expect(document.body.textContent).toContain(en.billing.confirmation.title);
		expect(confirm.disabled).toBe(false);
		confirm.click();
		await vi.waitFor(() => expect(autumn.attach).toHaveBeenCalledTimes(2));
	});
});

describe('user menu billing portal', () => {
	async function billingMenuItem(): Promise<HTMLElement> {
		await mountUnderProvider(NavUserHarness, {});
		document
			.getElementById('user-menu-trigger')!
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		return vi.waitFor(() => {
			const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
				(node) => node.textContent?.trim() === en.app.user_menu.billing
			);
			expect(item).toBeDefined();
			return item!;
		});
	}

	it.each([
		['unresolved', {}],
		['unavailable', { capabilities: { billing: unavailable, ai: usable } }]
	])('offers no billing portal while billing is %s', async (_state, data) => {
		state.page.data = data;
		const billing = await billingMenuItem();

		expect(billing.getAttribute('aria-disabled')).toBe('true');
		expect(billing.title).toBe(en.capabilities.billing_unavailable);
		billing.click();
		await tick();
		expect(autumn.openBillingPortal).not.toHaveBeenCalled();
	});

	it('opens the billing portal when billing is usable', async () => {
		state.page.data = { capabilities: { billing: usable, ai: usable } };
		const billing = await billingMenuItem();

		expect(billing.getAttribute('aria-disabled')).not.toBe('true');
		billing.click();
		await tick();
		expect(autumn.openBillingPortal).toHaveBeenCalledExactlyOnceWith({
			returnUrl: window.location.href
		});
	});
});

describe('AI chat page capability gate', () => {
	const viewer = { _id: 'user-1', name: 'Visitor' };

	async function mountPage(data: Record<string, unknown>, thread?: string): Promise<void> {
		state.page.url = new URL(
			`https://example.com/en/app/ai-chat${thread ? `?thread=${thread}` : ''}`
		);
		// The root provider and the page read the same load data.
		state.page.data = { viewer, ...data };
		await mountUnderProvider(AIChatPage as unknown as Component<{ data: unknown }>, {
			data: state.page.data
		});
	}

	function warmThreadRequests(): unknown[] {
		return vi
			.mocked(client.mutation)
			.mock.calls.filter(
				([reference]) => getFunctionName(reference) === 'aiChat/threads:getOrCreateWarmThread'
			);
	}

	describe.each([
		['unresolved', {}, en.capabilities.ai_unavailable],
		[
			'AI unavailable',
			{ capabilities: { billing: usable, ai: unavailable } },
			en.capabilities.ai_unavailable
		],
		[
			'billing unavailable',
			{ capabilities: { billing: unavailable, ai: usable } },
			en.capabilities.billing_unavailable
		]
	])('with %s', (_state, data, message) => {
		it('shows the unavailable state and resolves no thread', async () => {
			await mountPage(data);

			expect(statusText()).toContain(message);
			expect(warmThreadRequests()).toHaveLength(0);
			expect(threadChat).not.toHaveBeenCalled();
		});

		it('does not open a linked thread', async () => {
			await mountPage(data, 'thread-1');

			expect(statusText()).toContain(message);
			expect(threadChat).not.toHaveBeenCalled();
		});
	});

	it('resolves a warm thread when AI and billing are usable', async () => {
		await mountPage({ capabilities: { billing: usable, ai: usable } });

		expect(warmThreadRequests()).toHaveLength(1);
		expect(statusText()).toContain(en.aria.loading);
		expect(threadChat).not.toHaveBeenCalled();
	});

	it('opens a linked thread when AI and billing are usable', async () => {
		await mountPage({ capabilities: { billing: usable, ai: usable } }, 'thread-1');

		expect(threadChat).toHaveBeenCalledOnce();
		expect(threadChat.mock.calls[0]![1].threadId).toBe('thread-1');
		expect(warmThreadRequests()).toHaveLength(0);
	});

	it('lets the local e2e override enable chat without capabilities', async () => {
		await mountPage({
			capabilities: { billing: unavailable, ai: unavailable },
			localE2E: { aiChat: true }
		});

		expect(warmThreadRequests()).toHaveLength(1);
		expect(statusText()).not.toContain(en.capabilities.ai_unavailable);
	});

	it('starts an upgrade from the chat when billing is usable', async () => {
		autumn.checkout.mockReturnValue(new Promise(() => {}));
		await mountPage({ capabilities: { billing: usable, ai: usable } }, 'thread-1');

		void threadChat.mock.calls[0]![1].onUpgrade();
		await tick();

		expect(autumn.checkout).toHaveBeenCalledOnce();
		const successUrl = new URL(autumn.checkout.mock.calls[0]![0].successUrl);
		expect(successUrl.searchParams.get('thread')).toBeNull();
		expect(successUrl.searchParams.get('upgraded')).toBe('true');
	});

	it('refuses an upgrade from locally enabled chat while billing is unresolved', async () => {
		await mountPage({ localE2E: { aiChat: true } }, 'thread-1');

		await threadChat.mock.calls[0]![1].onUpgrade();

		expect(toast.error).toHaveBeenCalledExactlyOnceWith(en.capabilities.billing_unavailable);
		expect(autumn.checkout).not.toHaveBeenCalled();
	});

	it('backs off a failed warm thread with a fixed diagnostic', async () => {
		vi.mocked(client.mutation).mockRejectedValue(new Error(secret));
		await mountPage({ capabilities: { billing: usable, ai: usable } });

		await vi.waitFor(() =>
			expect(console.error).toHaveBeenCalledExactlyOnceWith('[AIChat.resolveWarmThread] Failed')
		);
		await tick();
		expect(warmThreadRequests()).toHaveLength(1);
		expect(goto).not.toHaveBeenCalled();
		expect(statusText()).toContain(en.aria.loading);
		expect(consoleOutput()).not.toContain(secret);
	});
});
