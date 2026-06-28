<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { onMount } from 'svelte';
	import { clockSkewContext } from '$lib/hooks/clock-skew.svelte';
	import { Button } from '$lib/components/ui/button';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import WifiOffIcon from '@lucide/svelte/icons/wifi-off';

	// Rendered by AuthenticatedLayout when there is no server-resolved user, instead
	// of a blank page. The client may still recover a session from cookies right
	// after hydration (AppAuthProvider revalidates app:auth), so show a calm
	// "connecting" state first and only escalate to an error after a grace window.
	const skew = clockSkewContext.getOr(undefined);

	let timedOut = $state(false);
	onMount(() => {
		const id = setTimeout(() => (timedOut = true), 8000);
		return () => clearTimeout(id);
	});

	const skewed = $derived(!!skew?.isSkewed);

	function retry() {
		location.reload();
	}
</script>

<div
	class="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center"
	data-testid="auth-connection-fallback"
>
	{#if !timedOut && !skewed}
		<LoaderIcon class="size-6 text-muted-foreground motion-safe:animate-spin" />
		<p class="text-sm text-muted-foreground"><T keyName="connection.fallback.connecting" /></p>
	{:else}
		<div class="flex max-w-md flex-col items-center gap-3">
			{#if skewed}
				<ClockIcon class="size-8 text-warning" />
				<h1 class="text-lg font-medium"><T keyName="connection.fallback.clock_title" /></h1>
				<p class="text-sm text-muted-foreground">
					<T
						keyName="connection.fallback.clock_description"
						params={{ offset: skew?.magnitude ?? '' }}
					/>
				</p>
			{:else}
				<WifiOffIcon class="size-8 text-muted-foreground" />
				<h1 class="text-lg font-medium"><T keyName="connection.fallback.offline_title" /></h1>
				<p class="text-sm text-muted-foreground">
					<T keyName="connection.fallback.offline_description" />
				</p>
			{/if}
			<Button variant="outline" onclick={retry} data-testid="auth-connection-retry">
				<T keyName="connection.fallback.retry" />
			</Button>
		</div>
	{/if}
</div>
