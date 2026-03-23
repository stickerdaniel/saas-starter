<script lang="ts">
	import AppAuthOAuthBootstrap from '$lib/components/app/app-auth-oauth-bootstrap.svelte';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<AppAuthOAuthBootstrap />
{@render children()}
