<script lang="ts">
	import type { Snippet } from 'svelte';
	import { AuthFlowManager, authFlowContext } from '$lib/hooks/auth-flow.svelte';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();

	// Per-request instance (no SSR cross-request leaks); the layout survives
	// client-side navigation between auth pages, so the remembered email does too
	authFlowContext.set(new AuthFlowManager());
</script>

<main id="main-content">
	{@render children?.()}
</main>
