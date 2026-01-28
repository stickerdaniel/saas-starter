<script lang="ts">
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { getPosthog, onPosthogReady } from '$lib/analytics/posthog';

	const auth = useAuth();
	const isAuthenticated = $derived(auth.isAuthenticated);
	let posthogReady = $state(false);

	function markPosthogReady(): void {
		posthogReady = true;
	}

	onMount(function onMountPosthogReady() {
		if (getPosthog()) {
			markPosthogReady();
			return;
		}

		return onPosthogReady(markPosthogReady);
	});

	function syncPosthogIdentify(): void {
		const viewer = page.data.viewer;

		if (!posthogReady) return;
		const posthog = getPosthog();
		if (!posthog) return;

		if (isAuthenticated && viewer?.email) {
			const properties: Record<string, string> = {
				email: viewer.email
			};

			if (viewer.name) properties.name = viewer.name;
			if (viewer._id) properties.userId = viewer._id;

			posthog.identify(viewer.email, properties);
			return;
		}

		if (!isAuthenticated) {
			posthog.reset();
		}
	}

	$effect(syncPosthogIdentify);
</script>
