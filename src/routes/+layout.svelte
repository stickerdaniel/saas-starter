<script lang="ts">
	import { setupConvexAuth } from '@mmailaender/convex-auth-svelte/sveltekit';
	import '../app.css';

	let { children, data } = $props();

	setupConvexAuth({
		getServerState: () => data.authState,
		options: { verbose: true }
	});
</script>

{@render children()}
