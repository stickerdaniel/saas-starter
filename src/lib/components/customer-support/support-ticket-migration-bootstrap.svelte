<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth-client';
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { api } from '$lib/convex/_generated/api';
	import { isAnonymousUser } from '$lib/convex/utils/anonymousUser';
	import { supportUserId } from './support-user-id.svelte';

	const auth = useAuth();
	const convexClient = useConvexClient();
	const attemptedSessionKeys = new SvelteSet<string>();

	let currentAuthenticatedUserId = $state<string | null>(null);

	// Session user ID recovers independently via cookies (works on prerendered pages)
	let sessionUserId = $state<string | null>(null);

	onMount(function onMountSessionSubscription() {
		return authClient.useSession().subscribe((s) => {
			sessionUserId = s.data?.user?.id ?? null;
		});
	});

	$effect(function resetAttemptsForAuthSessionEffect() {
		if (auth.isLoading) return;

		if (!auth.isAuthenticated || !sessionUserId) {
			attemptedSessionKeys.clear();
			currentAuthenticatedUserId = null;
			return;
		}

		if (currentAuthenticatedUserId !== sessionUserId) {
			attemptedSessionKeys.clear();
			currentAuthenticatedUserId = sessionUserId;
		}
	});

	$effect(function migrateAnonymousTicketsEffect() {
		if (!browser) return;

		if (auth.isLoading || !auth.isAuthenticated || !sessionUserId) return;

		const anonymousId = supportUserId.current;
		if (!anonymousId || !isAnonymousUser(anonymousId)) return;

		const sessionKey = `${sessionUserId}:${anonymousId}`;
		if (attemptedSessionKeys.has(sessionKey)) return;

		attemptedSessionKeys.add(sessionKey);

		convexClient
			.mutation(api.support.migration.migrateAnonymousTickets, {
				anonymousUserId: anonymousId
			})
			.then(function onMigrationSuccess() {
				// Update in-memory state via PersistedState (keeps reactive readers consistent),
				// then drop the storage entry — PersistedState.current = null serializes to the
				// 'null' literal which would leave litter in localStorage forever.
				supportUserId.current = null;
				localStorage.removeItem('supportUserId');
			})
			.catch(function onMigrationError(err: unknown) {
				console.error('Failed to migrate anonymous tickets:', err);
			});
	});
</script>
