<script lang="ts">
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth-client';
	import { onMount } from 'svelte';
	import { getPosthog, onPosthogReady } from '$lib/analytics/posthog';

	const auth = useAuth();
	const isAuthenticated = $derived(auth.isAuthenticated);
	let posthogReady = $state(false);

	// Session user data recovers independently via cookies (works on prerendered pages)
	let sessionUser = $state<{ id: string; email: string; name: string } | null>(null);

	onMount(function onMountPosthogIdentify() {
		let unsubPosthog: (() => void) | undefined;
		if (getPosthog()) {
			posthogReady = true;
		} else {
			unsubPosthog = onPosthogReady(() => {
				posthogReady = true;
			});
		}

		const unsubSession = authClient.useSession().subscribe((s) => {
			sessionUser = s.data?.user ?? null;
		});

		return () => {
			unsubPosthog?.();
			unsubSession();
		};
	});

	function syncPosthogIdentify(): void {
		if (!posthogReady) return;
		const posthog = getPosthog();
		if (!posthog) return;

		if (isAuthenticated && sessionUser?.email) {
			const properties: Record<string, string> = {
				email: sessionUser.email
			};

			if (sessionUser.name) properties.name = sessionUser.name;
			if (sessionUser.id) properties.userId = sessionUser.id;

			posthog.identify(sessionUser.email, properties);
			return;
		}

		if (!isAuthenticated) {
			posthog.reset();
		}
	}

	$effect(syncPosthogIdentify);
</script>
