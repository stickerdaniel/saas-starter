import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$lib/chat/ui/ChatInput.svelte', () => ({ default: () => {} }));
vi.mock('$lib/chat/ui/ChatMessages.svelte', () => ({ default: () => {} }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('$app/state', () => ({ page: { data: { lang: 'en' } } }));
vi.mock('$lib/auth-client', () => ({
	authClient: { useSession: () => ({ subscribe: () => () => {} }) }
}));
const media = vi.hoisted(() => ({ sm: false, lg: false, xl: false }));
vi.mock('$lib/hooks/use-media.svelte.ts', () => ({ useMedia: () => media }));
vi.mock('$lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));

import ChatTestProvider from '$lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import ThreadChat from './thread-chat.svelte';

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;

beforeEach(() => {
	client = new ConvexClient('https://chat-test.convex.cloud', { disabled: true });
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	await client.close();
	document.body.replaceChildren();
});

// The customer has no profile image, so the header avatar shows their initials.
const contentProps = {
	threadId: 'thread-1',
	initialThread: { userName: 'Ada Lovelace', userEmail: 'ada@example.com' },
	onBackClick: () => {}
};

it.each([
	['desktop header', true],
	['mobile sliding header', false]
])('shows the customer initials in the %s', async (_header, desktop) => {
	media.lg = desktop;
	component = mount(ChatTestProvider<typeof contentProps>, {
		target: document.body,
		props: { client, content: ThreadChat, contentProps }
	});
	await tick();

	expect([...document.querySelectorAll('h3')].map((node) => node.textContent)).toEqual([
		'Ada Lovelace'
	]);
	// The header is the only avatar on screen: the message list is stubbed out.
	const avatars = [...document.querySelectorAll('[data-slot="avatar-fallback"]')];
	expect(avatars.map((node) => node.textContent?.trim())).toEqual(['AL']);
});
