<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import ChatMessages from '../ChatMessages.svelte';
	import { setChatUIContext, type ChatUIContext } from '../chat-context.svelte.ts';

	// Provides the context directly: ChatRoot would replace the display messages from its query.
	let {
		context,
		perspective,
		authorHeadingLevel
	}: { context: ChatUIContext } & Pick<
		ComponentProps<typeof ChatMessages>,
		'perspective' | 'authorHeadingLevel'
	> = $props();

	// The context is fixed for the mounted test instance.
	// svelte-ignore state_referenced_locally
	setChatUIContext(context);
</script>

<ChatMessages {perspective} {authorHeadingLevel} />
