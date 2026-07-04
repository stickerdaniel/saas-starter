<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { clockSkewContext } from '$lib/hooks/clock-skew.svelte';
	import { shouldAutoReload } from './auth-fallback-recovery';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import { Button } from '$lib/components/ui/button';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import WifiOffIcon from '@lucide/svelte/icons/wifi-off';

	// Rendered by AuthenticatedLayout when there is no server-resolved user, instead
	// of a blank page. A healthy network can still land here after a transient SSR
	// auth miss, so before ever escalating to an error we try to self-heal in two
	// stages, both keyed on the client already holding a session from cookies:
	//
	//  Stage 1 (on mount): re-run the server loads that produce `viewer` by
	//    invalidating app:auth once. When the server can now resolve the session the
	//    parent re-renders with a user and unmounts this component, no reload needed.
	//    AppAuthProvider only invalidates once per client-auth transition, so the
	//    fallback issues its own attempt rather than leaning on the provider.
	//  Stage 2 (at the 8s grace timeout): still mounted means stage 1 did not recover,
	//    so fall back to one full document reload. The sessionStorage guard caps this
	//    at a single automatic reload; a persistent failure then shows the manual
	//    error state instead of reload-looping. sessionStorage (not localStorage)
	//    means a brand-new tab starts fresh, so the guard never permanently suppresses
	//    a legitimately needed future reload.
	const RELOAD_GUARD_KEY = 'auth-fallback-reloaded';

	const skew = clockSkewContext.getOr(undefined);
	const auth = useAuth();

	let timedOut = $state(false);

	// onMount runs client-only and once per mount, which satisfies the "browser only"
	// and "at most once" guards for both stages without extra flags.
	onMount(() => {
		// Stage 1: recover without a reload when the client session is already valid.
		if (!auth.isLoading && auth.isAuthenticated) {
			invalidate('app:auth');
		}

		const id = setTimeout(() => {
			// Stage 2: stage 1 did not recover within the grace window.
			if (
				shouldAutoReload({
					isAuthenticated: auth.isAuthenticated,
					isSkewed: !!skew?.isSkewed,
					alreadyReloaded: sessionStorage.getItem(RELOAD_GUARD_KEY) !== null
				})
			) {
				sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
				location.reload();
				return;
			}
			timedOut = true;
		}, 8000);
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
