import type { ComponentProps } from 'svelte';
import type ChatRoot from '#lib/chat/ui/ChatRoot.svelte';
import { describe, expectTypeOf, it } from 'vitest';
import type { ChatCore } from '#lib/chat/core/chat-core.svelte.ts';
import type { ChatCoreErrorCode } from '#lib/chat/index.js';
import type { ChatSessionPort, StreamCachePort } from '#lib/chat/core/chat-session-port.js';
import type { ChatUIContext } from '#lib/chat/ui/chat-context.svelte.ts';
import type { SupportConversation } from '#lib/components/customer-support/support-conversation.svelte.ts';

describe('first-party boundary compile-time contracts', () => {
	it('shares a structural chat session, never a concrete manager', () => {
		expectTypeOf<ChatCore>().toExtend<ChatSessionPort>();
		expectTypeOf<SupportConversation>().toExtend<ChatSessionPort>();
		expectTypeOf<ConstructorParameters<typeof ChatUIContext>[0]>().toEqualTypeOf<ChatSessionPort>();
		expectTypeOf<
			ComponentProps<typeof ChatRoot>['externalCore']
		>().toEqualTypeOf<ChatSessionPort>();
		expectTypeOf<{ api: never }>().not.toExtend<
			Pick<ComponentProps<typeof ChatRoot>, 'externalCore'>
		>();
		expectTypeOf<ChatSessionPort['streamCache']>().toEqualTypeOf<StreamCachePort>();
		expectTypeOf<ChatSessionPort['setAwaitingStream']>().toEqualTypeOf<
			(awaiting: boolean) => void
		>();
		expectTypeOf<ChatCore['error']>().toEqualTypeOf<ChatCoreErrorCode | null>();
		expectTypeOf<Parameters<ChatCore['setError']>[0]>().toEqualTypeOf<ChatCoreErrorCode | null>();
		expectTypeOf<{ threadId: number }>().not.toExtend<ChatSessionPort>();
	});
});
