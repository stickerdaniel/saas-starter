<script lang="ts">
	import type { Snippet } from 'svelte';
	import { setContext } from 'svelte';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();

	// Shared email state across auth pages (sign-in, sign-up, forgot-password)
	// This improves UX by remembering the email when switching between auth flows
	let email = $state('');

	setContext('auth:email', {
		get: () => email,
		set: (v: string) => (email = v)
	});
</script>

{@render children?.()}
