<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { api } from '$lib/convex/_generated/api';
	import { isAnonymousUser } from '$lib/convex/utils/anonymousUser';

	const auth = useAuth();
	const convexClient = useConvexClient();
	const attemptedSessionKeys = new SvelteSet<string>();

	let currentAuthenticatedUserId = $state<string | null>(null);

	$effect(function resetAttemptsForAuthSessionEffect() {
		if (auth.isLoading) return;

		const viewerId = page.data.viewer?._id ?? null;
		if (!auth.isAuthenticated || !viewerId) {
			attemptedSessionKeys.clear();
			currentAuthenticatedUserId = null;
			return;
		}

		if (currentAuthenticatedUserId !== viewerId) {
			attemptedSessionKeys.clear();
			currentAuthenticatedUserId = viewerId;
		}
	});

	$effect(function migrateAnonymousTicketsEffect() {
		if (!browser) return;

		const viewerId = page.data.viewer?._id;
		if (auth.isLoading || !auth.isAuthenticated || !viewerId) return;

		const anonymousId = localStorage.getItem('supportUserId');
		if (!anonymousId || !isAnonymousUser(anonymousId)) return;

		const sessionKey = `${viewerId}:${anonymousId}`;
		if (attemptedSessionKeys.has(sessionKey)) return;

		attemptedSessionKeys.add(sessionKey);

		convexClient
			.mutation(api.support.migration.migrateAnonymousTickets, {
				anonymousUserId: anonymousId
			})
			.then(function onMigrationSuccess() {
				localStorage.removeItem('supportUserId');
			})
			.catch(function onMigrationError(err: unknown) {
				console.error('Failed to migrate anonymous tickets:', err);
			});
	});
</script>
