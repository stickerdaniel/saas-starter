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
	 * Place it directly above the card column; it takes that column's width.
	 * It is collapsed at first paint and revealed after a delay that a normal
	 * load beats, so visitors whose page hydrates never see it and the card does
	 * not move when it goes. Without scripting there is nothing to wait for, and
	 * the `<noscript>` style shows it at once. That style rather than
	 * `@media (scripting: none)`, which Safari before 17 lacks.
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

<svelte:head>
	<noscript>
		<!-- Outranks the scoped delay below, whose selector carries a hash class. -->
		<style>
			[data-javascript-notice] {
				visibility: visible !important;
				height: auto !important;
				animation: none !important;
			}
		</style>
	</noscript>
</svelte:head>

{#if !hydrated}
	<div role="status" class="w-full max-w-sm md:max-w-3xl">
		<div data-javascript-notice class="javascript-notice">
			<p
				class="mb-6 rounded-xl border border-warning/20 bg-warning/10 px-4 py-3 text-center text-sm text-balance text-foreground"
			>
				<TriangleAlertIcon class="me-1.5 inline-block size-4 align-text-bottom text-warning" />
				<T keyName="auth.javascript_required" />
			</p>
		</div>
	</div>
{/if}

<style>
	/* Collapsed, not only invisible: a hidden box that kept its height would push
	   the centered card down until hydration removed it. The overflow clip also
	   keeps the paragraph's bottom margin inside the collapsed box. */
	.javascript-notice {
		visibility: hidden;
		height: 0;
		overflow: hidden;
		animation: javascript-notice-reveal 0s 4s forwards;
	}

	@keyframes javascript-notice-reveal {
		to {
			visibility: visible;
			height: auto;
		}
	}
</style>
