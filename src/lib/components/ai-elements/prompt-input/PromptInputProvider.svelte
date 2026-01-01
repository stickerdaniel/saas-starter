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

	let { initialInput = '', accept, multiple = true, children }: Props = $props();

	promptInputProviderContext.set(new PromptInputController(initialInput, accept, multiple));
</script>

{#if children}
	{@render children()}
{/if}
