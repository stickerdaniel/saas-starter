<script lang="ts">
	import { onMount } from 'svelte';
	import { T } from '@tolgee/svelte';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	/**
	 * Explains the disabled auth controls, which only enable once the page has
	 * hydrated. Rendered on the server rather than inside `<noscript>`, so it also
	 * reaches a browser whose bundle failed to load or hydrate, and removed on
	 * mount.
	 *
	 * Hidden at first paint and revealed after a delay that a normal load beats,
	 * so visitors whose page hydrates never see it. Without scripting there is
	 * nothing to wait for, and it shows at once.
	 *
	 * The status region itself stays exposed while its content is hidden, so
	 * the content revealed after a failed hydration is announced as an addition
	 * to a live region that already exists. A normal load removes the region
	 * while it is still empty, which announces nothing.
	 */
	let hydrated = $state(false);

	onMount(() => {
		hydrated = true;
	});
</script>

{#if !hydrated}
	<div role="status" class="pointer-events-none fixed inset-x-0 top-0 z-50">
		<div class="javascript-notice pointer-events-auto bg-background">
			<p class="border-b border-warning/20 bg-warning/10 p-4 text-center text-foreground">
				<TriangleAlertIcon class="me-1.5 inline-block size-4 align-text-bottom text-warning" />
				<T keyName="auth.javascript_required" />
			</p>
		</div>
	</div>
{/if}

<style>
	.javascript-notice {
		visibility: hidden;
		animation: javascript-notice-reveal 0s 4s forwards;
	}

	@media (scripting: none) {
		.javascript-notice {
			visibility: visible;
			animation: none;
		}
	}

	@keyframes javascript-notice-reveal {
		to {
			visibility: visible;
		}
	}
</style>
