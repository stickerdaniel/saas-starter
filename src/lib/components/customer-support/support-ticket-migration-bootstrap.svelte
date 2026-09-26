<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth-client';
	import { useConvexClient } from 'convex-svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { api } from '$lib/convex/_generated/api';
	import { isAnonymousUser } from '$lib/convex/utils/anonymousUser';
	import { supportUserId } from './support-user-id.svelte.ts';

	// Bounds one login's calls; each call moves up to 100 threads.
	const MAX_MIGRATION_CALLS = 50;

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

		migrateAllPages(anonymousId).catch(function onMigrationError() {
			console.error('[SupportMigration.migrateAnonymousTickets] Failed');
		});
	});

	// Each call moves one page. The anonymous ID is forgotten only once the last
	// page has moved, so a failed or unfinished run resumes at the next login.
	async function migrateAllPages(anonymousId: string): Promise<void> {
		for (let call = 0; call < MAX_MIGRATION_CALLS; call++) {
			const { done } = await convexClient.mutation(api.support.migration.migrateAnonymousTickets, {
				anonymousUserId: anonymousId
			});
			if (!done) continue;

			// Update in-memory state via PersistedState (keeps reactive readers consistent),
			// then drop the storage entry — PersistedState.current = null serializes to the
			// 'null' literal which would leave litter in localStorage forever.
			supportUserId.current = null;
			localStorage.removeItem('supportUserId');
			return;
		}
		console.error('[SupportMigration.migrateAnonymousTickets] Unfinished');
	}
</script>
