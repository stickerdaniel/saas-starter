<script lang="ts">
	import { getChatUIContext } from '../chat-context.svelte.ts';

	const ctx = getChatUIContext();
</script>

<ol data-testid="displayed-messages">
	{#each ctx.displayMessages as message (message.id)}
		<li>{message.displayText}</li>
	{/each}
</ol>
