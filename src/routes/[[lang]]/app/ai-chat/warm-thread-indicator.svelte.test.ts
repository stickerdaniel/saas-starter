import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount, type ComponentProps } from 'svelte';
import type * as Svelte from 'svelte';
import en from '../../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@tolgee/svelte', async () => {
	const { translation } = await import('../../admin/support/test-fixtures/translation');
	return { getTranslate: () => ({ t: translation }) };
});

const mocks = vi.hoisted(() => ({
	mutation: vi.fn(),
	page: { url: new URL('https://example.com/en/app/ai-chat') }
}));

vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('convex-svelte', () => ({
	useConvexClient: () => ({ mutation: mocks.mutation }),
	useQuery: () => ({ data: { _id: 'user-1' }, error: undefined, isLoading: false })
}));
vi.mock('@stickerdaniel/convex-autumn-svelte/sveltekit', () => ({
	useCustomer: () => ({ customer: { products: [], features: {} }, refetch: vi.fn() })
}));
vi.mock('#lib/components/billing/index.js', () => ({
	useBillingCheckout: () => ({ start: vi.fn(), isLoading: false })
}));
vi.mock('#lib/components/SEOHead.svelte', () => ({ default: () => {} }));
vi.mock('./thread-chat.svelte', () => ({ default: () => {} }));

import { useDictionary } from '../../admin/support/test-fixtures/translation';
import AIChatPage from './+page.svelte';

let component: ReturnType<typeof mount> | undefined;

beforeEach(() => {
	useDictionary(en);
	mocks.mutation.mockReset();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

const indicator = () => document.querySelector('[role="status"] svg')!;

it('spins while a thread is requested and rests during the retry backoff', async () => {
	const request = Promise.withResolvers<never>();
	mocks.mutation.mockReturnValue(request.promise);
	component = mount(AIChatPage, {
		target: document.body,
		props: {
			data: {
				viewer: { _id: 'user-1' },
				capabilities: { billing: { usable: true }, ai: { usable: true } }
			}
		} as unknown as ComponentProps<typeof AIChatPage>
	});
	flushSync();

	expect(mocks.mutation).toHaveBeenCalledOnce();
	expect(indicator().classList).toContain('motion-safe:animate-spin');

	request.reject(new Error('thread create rate limited'));
	await vi.waitFor(() => expect(indicator().classList).not.toContain('motion-safe:animate-spin'));
	await tick();
	expect(mocks.mutation).toHaveBeenCalledOnce();
});
