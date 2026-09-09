<script module lang="ts">
	import type { ChatUIContext } from '../chat-context.svelte.ts';

	export const capturedChatMessages: { context?: ChatUIContext } = {};
</script>

<script lang="ts">
	import { getChatUIContext } from '../chat-context.svelte.ts';

	capturedChatMessages.context = getChatUIContext();
</script>
