<script module lang="ts">
	import type { ComponentProps } from 'svelte';
	import type ChatInput from '../ChatInput.svelte';
	import type { ChatUIContext } from '../chat-context.svelte.ts';

	export const capturedInput: {
		props?: ComponentProps<typeof ChatInput>;
		context?: ChatUIContext;
	} = {};
</script>

<script lang="ts">
	import { getChatUIContext } from '../chat-context.svelte.ts';

	let props: ComponentProps<typeof ChatInput> = $props();
	capturedInput.context = getChatUIContext();
	$effect(() => {
		capturedInput.props = props;
	});
</script>
