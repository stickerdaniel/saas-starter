<script lang="ts">
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { page } from '$app/state';
	import posthog from 'posthog-js';

	const auth = useAuth();
	const isAuthenticated = $derived(auth.isAuthenticated);

	$effect(() => {
		// Effect tracks: isAuthenticated, page.data.viewer
		const viewer = page.data.viewer;

		if (isAuthenticated && viewer?.email) {
			// User logged in - identify them in PostHog
			const properties: Record<string, string> = {
				email: viewer.email
			};

			// Add optional properties only if they exist
			if (viewer.name) properties.name = viewer.name;
			if (viewer._id) properties.userId = viewer._id;

			posthog.identify(viewer.email, properties);
		} else if (!isAuthenticated) {
			// User logged out - reset PostHog to start fresh anonymous session
			posthog.reset();
		}
	});
</script>
