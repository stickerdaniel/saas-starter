<script lang="ts">
	import type { Snippet } from 'svelte';

	/** The status line in a founder email card footer: a dot that fills while the email sends. */
	let { sending, children }: { sending: boolean; children: Snippet } = $props();
</script>

<p class="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
	<span
		aria-hidden="true"
		class={['size-2 shrink-0 rounded-full', sending ? 'bg-primary' : 'bg-muted-foreground/40']}
	></span>
	<span class="truncate">{@render children()}</span>
</p>
