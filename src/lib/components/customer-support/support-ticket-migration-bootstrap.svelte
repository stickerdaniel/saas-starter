<script lang="ts">
	import { browser } from '$app/env';
	import { onMount } from 'svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '#lib/auth-client.js';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { api } from '#lib/convex/_generated/api.js';
	import { isAnonymousUser } from '#lib/convex/utils/anonymousUser.js';
	import { clearSupportUserId, supportUserId } from './support-user-id.svelte.ts';

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

	// auth.isAuthenticated already holds the server-rendered state while the
	// socket still waits for its token. A mutation sent in that gap can run
	// signed out, and this page sends the migration only once. The server
	// answers this query with the session's user only after it accepted the
	// token, so the migration waits for that answer.
	const confirmedViewer = useQuery(api.users.viewer, () =>
		!auth.isLoading && auth.isAuthenticated && isAnonymousUser(supportUserId.current) ? {} : 'skip'
	);

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
		if (confirmedViewer.data?._id !== sessionUserId) return;

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
				clearSupportUserId();
			})
			.catch(function onMigrationError() {
				console.error('[SupportMigration.migrateAnonymousTickets] Failed');
			});
	});
</script>
