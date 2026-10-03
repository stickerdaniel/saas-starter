<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { pendingPasskeyNudge } from '$lib/hooks/passkey-nudge.svelte.ts';
	import { claimPasskeyNudge, type PasskeyNudgeUser } from '$lib/utils/passkey-nudge';
	import * as Card from '$lib/components/ui/card';
	import PasskeyOffer from './passkey-offer.svelte';
	import type { PendingOAuthProvider } from '$lib/hooks/last-auth-method.svelte.ts';

	const client = useConvexClient();
	const auth = useAuth();
	let offer = $state<{ user: PasskeyNudgeUser; provider: PendingOAuthProvider } | null>(null);

	$effect(() => {
		const pending = pendingPasskeyNudge.current;
		if (auth.isLoading || !auth.isAuthenticated || !pending) return;
		let cancelled = false;
		void claimPasskeyNudge(client, pending.sessionId).then((user) => {
			if (cancelled) return;
			pendingPasskeyNudge.current = null;
			if (user && auth.isAuthenticated) offer = { user, provider: pending.provider };
		});
		return () => {
			cancelled = true;
		};
	});
</script>

{#if offer && auth.isAuthenticated}
	<div class="max-h-80 shrink-0 overflow-auto px-4 pt-4 md:px-6">
		<Card.Root class="max-w-xl">
			<Card.Content>
				<PasskeyOffer
					user={offer.user}
					provider={offer.provider}
					inline
					oncontinue={() => {
						offer = null;
					}}
				/>
			</Card.Content>
		</Card.Root>
	</div>
{/if}
