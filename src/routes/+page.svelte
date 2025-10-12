<script>
	import { useAuth } from '@mmailaender/convex-auth-svelte/sveltekit';
	import { Button } from '$lib/components/ui/button/index.js';
	import HeroFive from '../blocks/hero/hero-five.svelte';
	import IntegrationOne from '../blocks/integration/integration-one.svelte';

	const { signOut } = useAuth();
	const isAuthenticated = $derived(useAuth().isAuthenticated);
</script>

<HeroFive />
<IntegrationOne />

<div class="flex min-h-[50vh] flex-col items-center justify-center gap-4">
	{#if isAuthenticated}
		<p>You are authenticated!</p>
		<Button href="/product">Product</Button>
		<Button onclick={() => signOut()} variant="secondary">Sign Out</Button>
	{:else}
		<p>You are not authenticated.</p>
		<Button href="/signin">Get Started</Button>
	{/if}
</div>
