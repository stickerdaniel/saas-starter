<script lang="ts">
	import {
		PromptInputController,
		promptInputProviderContext
	} from './attachments-context.svelte.js';

	interface Props {
		initialInput?: string;
		accept?: string;
		multiple?: boolean;
		children?: import('svelte').Snippet;
	}

	const { initialInput = '', accept, multiple = true, children }: Props = $props();

	// PromptInputController is intentionally initialized once.
	// svelte-ignore state_referenced_locally
	promptInputProviderContext.set(new PromptInputController(initialInput, accept, multiple));
</script>

{#if children}
	{@render children()}
{/if}
