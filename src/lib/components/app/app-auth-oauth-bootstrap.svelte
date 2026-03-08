<script lang="ts">
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { commitOAuthSuccessIfPending } from '$lib/hooks/last-auth-method.svelte';

	const auth = useAuth();

	$effect(function commitPendingOAuthMethodEffect() {
		if (auth.isLoading || !auth.isAuthenticated) return;
		commitOAuthSuccessIfPending();
	});
</script>
