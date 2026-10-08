<script lang="ts">
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { commitOAuthSuccessIfPending } from '#lib/hooks/last-auth-method.svelte.ts';
	import { offerPasskeyAfterOAuth } from '#lib/hooks/passkey-nudge.svelte.ts';

	const auth = useAuth();

	$effect(function commitPendingOAuthMethodEffect() {
		if (auth.isLoading || !auth.isAuthenticated) return;
		const provider = commitOAuthSuccessIfPending();
		if (provider) void offerPasskeyAfterOAuth(provider);
	});
</script>
