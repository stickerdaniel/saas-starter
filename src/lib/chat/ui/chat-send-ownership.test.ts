import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';
import type { ChatSessionPort } from '../core/chat-session-port.js';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import ChatSessionPortHarness from './test-fixtures/ChatSessionPortHarness.svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

describe('ChatInput send ownership', () => {
	it('renders from the narrow session port without a concrete ChatCore', async () => {
		const session: ChatSessionPort = {
			threadId: null,
			isNewConversation: true,
			threadGeneration: 0,
			isSending: false,
			isAwaitingStream: false,
			setAwaitingStream: () => {},
			streamCache: {
				getCachedReasoning: () => undefined,
				updateReasoningCache: () => {},
				clearReasoningCache: () => {},
				updateStatusCache: () => {}
			}
		};
		const client = new ConvexClient('https://session-port-test.convex.cloud', {
			disabled: true
		});
		const contentProps = { session };
		const component = mount(ChatTestProvider<typeof contentProps>, {
			target: document.body,
			props: { client, content: ChatSessionPortHarness, contentProps }
		});
		await tick();

		expect(document.querySelector('[data-testid="session-port-child"]')).not.toBeNull();

		await unmount(component);
		await client.close();
	});
});
