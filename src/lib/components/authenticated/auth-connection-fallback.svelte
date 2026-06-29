<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { onMount } from 'svelte';
	import { clockSkewContext } from '$lib/hooks/clock-skew.svelte';
	import * as Empty from '$lib/components/ui/empty/index.js';
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

<main
	id="main-content"
	class="grid min-h-[100dvh] w-full place-items-center px-4 py-8"
	data-testid="auth-connection-fallback"
>
	<Empty.Root class="w-full max-w-xl">
		{#if !timedOut && !skewed}
			<Empty.Header>
				<Empty.Media>
					<LoaderIcon class="size-6 text-muted-foreground motion-safe:animate-spin" />
				</Empty.Media>
				<Empty.Title><T keyName="connection.fallback.connecting" /></Empty.Title>
			</Empty.Header>
		{:else}
			<Empty.Header>
				<Empty.Media variant="icon">
					{#if skewed}
						<ClockIcon class="text-warning" />
					{:else}
						<WifiOffIcon class="text-muted-foreground" />
					{/if}
				</Empty.Media>
				<Empty.Title>
					{#if skewed}
						<T keyName="connection.fallback.clock_title" />
					{:else}
						<T keyName="connection.fallback.offline_title" />
					{/if}
				</Empty.Title>
				<Empty.Description>
					{#if skewed}
						<T
							keyName="connection.fallback.clock_description"
							params={{ offset: skew?.magnitude ?? '' }}
						/>
					{:else}
						<T keyName="connection.fallback.offline_description" />
					{/if}
				</Empty.Description>
			</Empty.Header>
			<Empty.Content>
				<Button variant="outline" onclick={retry} data-testid="auth-connection-retry">
					<T keyName="connection.fallback.retry" />
				</Button>
			</Empty.Content>
		{/if}
	</Empty.Root>
</main>
